import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/db.js';
import { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import { LocalVolumeObjectStore } from '../storage/local-volume-object-store.js';
import { requireAuth } from '../auth/auth-plugin.js';
import { PreviewService } from './preview-service.js';
import { resolvePreviewIdFromHost } from './preview-host-resolver.js';
import { classifyRequestPlane } from '../http-host-policy.js';
import { servePreview } from './static-site-handler.js';


function multipartFieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const raw = fields[name] as any;
  const part = Array.isArray(raw) ? raw[0] : raw;
  return part?.type === 'field' && typeof part.value !== 'undefined' ? String(part.value) : undefined;
}

function previewResponse(preview: { id:string; hostname:string; displayName:string|null; status:string; createdAt:Date; updatedAt:Date; expiresAt:Date; compressedSizeBytes:number|null; extractedSizeBytes:number|null; fileCount:number|null; sourceSha256:string|null; sourceType:string }) {
  return {
    previewId: preview.id,
    url: `https://${preview.hostname}`,
    name: preview.displayName,
    status: preview.status,
    createdAt: preview.createdAt.toISOString(),
    updatedAt: preview.updatedAt.toISOString(),
    expiresAt: preview.expiresAt.toISOString(),
    compressedSizeBytes: preview.compressedSizeBytes,
    extractedSizeBytes: preview.extractedSizeBytes,
    fileCount: preview.fileCount,
    sourceSha256: preview.sourceSha256,
    sourceType: preview.sourceType,
  };
}

export async function registerPreviewHttp(app: FastifyInstance, config: AppConfig, pool: DatabasePool): Promise<void> {
  await app.register(multipart, { limits: { fileSize: config.maxCompressedBytes, files: 1, fields: 4 } });
  const store = new LocalVolumeObjectStore(config.dataRoot);
  await store.initialize();
  const repository = new PreviewRepository(pool);
  const service = new PreviewService(config, repository, store);

  app.addHook('onRequest', async (request, reply) => {
    const plane = classifyRequestPlane(request.headers.host, config.controlPlaneHost, config.previewDomainSuffix);
    if (plane !== 'PREVIEW') return;
    const id = resolvePreviewIdFromHost(request.headers.host, config.previewDomainSuffix);
    if (!id) { await reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' }); return; }
    await servePreview(request, reply, id, repository, store);
  });

  app.setNotFoundHandler(async (request, reply) => {
    const plane = classifyRequestPlane(request.headers.host, config.controlPlaneHost, config.previewDomainSuffix);
    if (plane === 'PREVIEW') {
      const id = resolvePreviewIdFromHost(request.headers.host, config.previewDomainSuffix);
      if (!id) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
      await servePreview(request, reply, id, repository, store);
      return;
    }
    return reply.code(404).send({ error: 'NOT_FOUND' });
  });

  app.get('/api/previews', { preHandler: requireAuth }, async (request) => {
    const previews = await service.listOwned(request.authContext!.userId);
    return { previews: previews.map(previewResponse) };
  });

  app.get('/api/previews/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const preview = await service.getOwned(request.authContext!.userId, id);
    if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
    return previewResponse(preview);
  });

  app.put('/api/previews/:id/content', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      if (!request.isMultipart()) {
        const body = (request.body ?? {}) as { sourceUrl?: unknown };
        if (typeof body.sourceUrl !== 'string' || !body.sourceUrl.trim()) return reply.code(400).send({ error: 'SOURCE_URL_REQUIRED' });
        const preview = await service.updateFromUrl({ ownerUserId: request.authContext!.userId, previewId: id, sourceUrl: body.sourceUrl.trim() });
        if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
        return previewResponse(preview);
      }
      const part = await request.file();
      if (!part) return reply.code(400).send({ error: 'ARTIFACT_REQUIRED' });
      const dir = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-update-'));
      const archivePath = path.join(dir, 'artifact');
      try {
        await pipeline(part.file, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
        if (part.file.truncated) throw new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT');
        const preview = await service.updateFromFile({ ownerUserId: request.authContext!.userId, previewId: id, archivePath });
        if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
        return previewResponse(preview);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PREVIEW_UPDATE_FAILED';
      request.log.warn({ err: message }, 'preview update failed');
      const status = ['IMPORT_CONCURRENCY_LIMIT','USER_STORAGE_QUOTA_LIMIT','TOTAL_STORAGE_QUOTA_LIMIT'].includes(message) ? 429 : message.startsWith('SOURCE_URL_') ? 400 : 422;
      return reply.code(status).send({ error: message });
    }
  });

  app.post('/api/previews/:id/extend', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { lifetimeMinutes?: unknown };
    const lifetimeMinutes = Number(body.lifetimeMinutes);
    try {
      const preview = await service.extendOwned(request.authContext!.userId, id, lifetimeMinutes);
      if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
      return previewResponse(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PREVIEW_EXTEND_FAILED';
      return reply.code(message === 'INVALID_TTL' || message === 'INVALID_EXTENSION' ? 400 : 422).send({ error: message });
    }
  });

  app.delete('/api/previews/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await service.deleteOwned(request.authContext!.userId, id);
    if (!deleted) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
    return reply.code(204).send();
  });

  app.post('/api/previews', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.isMultipart()) {
      const body = (request.body ?? {}) as { sourceUrl?: unknown; lifetimeMinutes?: unknown; name?: unknown };
      if (typeof body.sourceUrl !== 'string' || !body.sourceUrl.trim()) return reply.code(400).send({ error: 'SOURCE_URL_REQUIRED' });
      try {
        const preview = await service.createFromUrl({
          ownerUserId: request.authContext!.userId,
          sourceUrl: body.sourceUrl.trim(),
          ...(body.lifetimeMinutes !== undefined ? { lifetimeMinutes: Number(body.lifetimeMinutes) } : {}),
          ...(typeof body.name === 'string' && body.name.trim() ? { displayName: body.name.trim() } : {}),
        });
        return reply.code(201).send({ previewId: preview.id, url: `https://${preview.hostname}`, createdAt: preview.createdAt.toISOString(), expiresAt: preview.expiresAt.toISOString(), status: preview.status });
      } catch (error) {
        request.log.warn({ err: error instanceof Error ? error.message : 'url import failed' }, 'preview URL creation failed');
        const message = error instanceof Error ? error.message : 'PREVIEW_CREATE_FAILED';
        const status = ['ACTIVE_PREVIEW_LIMIT','IMPORT_CONCURRENCY_LIMIT','USER_STORAGE_QUOTA_LIMIT','TOTAL_STORAGE_QUOTA_LIMIT'].includes(message) ? 429 : message === 'INVALID_TTL' || message.startsWith('SOURCE_URL_') ? 400 : 422;
        return reply.code(status).send({ error: message });
      }
    }
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'ARTIFACT_REQUIRED' });
    const lifetimeRaw = multipartFieldValue(part.fields as unknown as Record<string, unknown>, 'lifetimeMinutes');
    const nameRaw = multipartFieldValue(part.fields as unknown as Record<string, unknown>, 'name');
    const lifetimeMinutes = lifetimeRaw === undefined ? undefined : Number(lifetimeRaw);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-upload-'));
    const archivePath = path.join(dir, 'artifact');
    try {
      await pipeline(part.file, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
      if (part.file.truncated) throw new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT');
      const preview = await service.createFromFile({
        ownerUserId: request.authContext!.userId,
        archivePath,
        ...(lifetimeMinutes !== undefined ? { lifetimeMinutes } : {}),
        ...(typeof nameRaw === 'string' && nameRaw.trim() ? { displayName: nameRaw.trim() } : {}),
      });
      return reply.code(201).send({
        previewId: preview.id,
        url: `https://${preview.hostname}`,
        createdAt: preview.createdAt.toISOString(),
        expiresAt: preview.expiresAt.toISOString(),
        status: preview.status,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'preview creation failed');
      const message = error instanceof Error ? error.message : 'PREVIEW_CREATE_FAILED';
      const status = ['ACTIVE_PREVIEW_LIMIT','IMPORT_CONCURRENCY_LIMIT','USER_STORAGE_QUOTA_LIMIT','TOTAL_STORAGE_QUOTA_LIMIT'].includes(message) ? 429 : message === 'INVALID_TTL' ? 400 : 422;
      return reply.code(status).send({ error: message });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

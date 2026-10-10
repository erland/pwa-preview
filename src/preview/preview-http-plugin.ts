import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import type { LocalPreviewStorage } from '../storage/local-preview-storage.js';
import { requireAuth } from '../auth/auth-plugin.js';
import type { PreviewService } from './preview-service.js';
import { resolvePreviewIdFromHost } from './preview-host-resolver.js';
import { classifyRequestPlane } from '../http-host-policy.js';
import { servePreview } from './static-site-handler.js';
import { isApplicationError } from '../errors/application-error.js';
import { toPreviewOutput } from './preview-output.js';
import { exportPreviewZip } from './preview-zip-export.js';
import { previewStorageKey } from '../storage/storage-key.js';
import { createUrlInputSchema, extendInputSchema, lifetimeMinutesSchema, previewIdSchema, previewNameSchema, updateUrlInputSchema } from './preview-input.js';


function errorCode(error: unknown, fallback: string): string {
  if (isApplicationError(error)) return error.code;
  return error instanceof Error ? error.message : fallback;
}

function validationError(result: { error: { issues: Array<{ message: string }> } }): string {
  return result.error.issues[0]?.message ?? 'INVALID_INPUT';
}

function multipartFieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const raw = fields[name] as any;
  const part = Array.isArray(raw) ? raw[0] : raw;
  return part?.type === 'field' && typeof part.value !== 'undefined' ? String(part.value) : undefined;
}


export async function registerPreviewHttp(
  app: FastifyInstance,
  config: AppConfig,
  service: PreviewService,
  repository: PreviewRepository,
  store: LocalPreviewStorage,
): Promise<void> {
  await app.register(multipart, { limits: { fileSize: config.maxCompressedBytes, files: 1, fields: 4 } });

  app.addHook('onRequest', async (request, reply) => {
    const plane = classifyRequestPlane(request.headers.host, config.controlPlaneHost, config.previewDomainSuffix);
    if (plane !== 'PREVIEW') return;
    const id = await resolvePublishedId(request.headers.host);
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

  async function resolvePublishedId(host: string | undefined): Promise<string | null> {
    const id = resolvePreviewIdFromHost(host, config.previewDomainSuffix);
    if (id) return id;
    const normalized = host?.split(':', 1)[0]?.toLowerCase() ?? '';
    const suffix = '.' + config.previewDomainSuffix.toLowerCase();
    if (!normalized.endsWith(suffix)) return null;
    const slug = normalized.slice(0, -suffix.length);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40) return null;
    const found = await repository.findReadyBySlug(slug);
    return found?.id ?? null;
  }

  app.post('/api/previews/:id/promote', { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!previewIdSchema.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_PREVIEW_ID' });
    const slug = String((request.body as { slug?: unknown } | undefined)?.slug ?? '').toLowerCase();
    const reserved = new Set(['www','api','auth','mcp','admin','login','health','ready','support','static','assets']);
    if (slug.length < 3 || slug.length > 40 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || reserved.has(slug) || /^p-[a-f0-9]{32}$/.test(slug)) {
      return reply.code(400).send({ error: 'INVALID_PUBLICATION_SLUG' });
    }
    try {
      const preview = await repository.promoteOwned(request.authContext!.userId, id, slug);
      if (!preview) return reply.code(409).send({ error: 'PROMOTION_NOT_AVAILABLE' });
      return toPreviewOutput(preview);
    } catch (error) {
      if ((error as {code?:string}).code === '23505') return reply.code(409).send({ error: 'PUBLICATION_SLUG_TAKEN' });
      if ((error as {message?:string}).message === 'PERMANENT_PREVIEW_LIMIT') return reply.code(409).send({ error: 'PERMANENT_PREVIEW_LIMIT' });
      throw error;
    }
  });

  app.get('/api/previews', { preHandler: requireAuth }, async (request) => {
    const previews = await service.listOwned(request.authContext!.userId);
    return { previews: previews.map(toPreviewOutput) };
  });

  app.patch('/api/previews/:id/name', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!previewIdSchema.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_PREVIEW_ID' });
    if (request.headers.origin !== 'https://' + config.controlPlaneHost) return reply.code(403).send({ error: 'INVALID_REQUEST_ORIGIN' });
    const parsed = previewNameSchema.safeParse((request.body as { name?: unknown } | undefined)?.name);
    if (!parsed.success) return reply.code(400).send({ error: validationError(parsed) });
    const preview = await repository.renameOwned(request.authContext!.userId, id, parsed.data);
    if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
    return toPreviewOutput(preview);
  });

  app.get('/api/previews/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = previewIdSchema.safeParse(id);
    if (!parsedId.success) return reply.code(400).send({ error: validationError(parsedId) });
    const preview = await service.getOwned(request.authContext!.userId, parsedId.data);
    if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
    return toPreviewOutput(preview);
  });

  // UI download; intentionally not exposed via MCP.
  app.get('/api/previews/:id/download', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = previewIdSchema.safeParse(id);
    if (!parsedId.success) return reply.code(400).send({ error: validationError(parsedId) });
    const preview = await service.getOwned(request.authContext!.userId, parsedId.data);
    if (!preview || preview.status !== 'READY' || (preview.expiresAt && preview.expiresAt <= new Date())) {
      return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
    }
    try {
      const zip = await exportPreviewZip(store.getPreviewSiteRoot(previewStorageKey(parsedId.data)));
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${parsedId.data}.zip"`)
        .header('Cache-Control', 'private, no-store')
        .send(zip.outputStream);
    } catch (error) {
      request.log.error({ err: error }, 'preview ZIP export failed');
      return reply.code(500).send({ error: 'PREVIEW_EXPORT_FAILED' });
    }
  });

  app.put('/api/previews/:id/content', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = previewIdSchema.safeParse(id);
    if (!parsedId.success) return reply.code(400).send({ error: validationError(parsedId) });
    try {
      if (!request.isMultipart()) {
        const body = (request.body ?? {}) as { sourceUrl?: unknown };
        if (body.sourceUrl === undefined) return reply.code(400).send({ error: 'SOURCE_URL_REQUIRED' });
        const parsed = updateUrlInputSchema().safeParse({ previewId: parsedId.data, sourceUrl: body.sourceUrl });
        if (!parsed.success) return reply.code(400).send({ error: validationError(parsed) });
        const preview = await service.updateFromUrl({ ownerUserId: request.authContext!.userId, ...parsed.data });
        if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
        return toPreviewOutput(preview);
      }
      const part = await request.file();
      if (!part) return reply.code(400).send({ error: 'ARTIFACT_REQUIRED' });
      const dir = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-update-'));
      const archivePath = path.join(dir, 'artifact');
      try {
        await pipeline(part.file, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
        if (part.file.truncated) throw new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT');
        const preview = await service.updateFromFile({ ownerUserId: request.authContext!.userId, previewId: parsedId.data, archivePath });
        if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
        return toPreviewOutput(preview);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch (error) {
      const message = errorCode(error, 'PREVIEW_UPDATE_FAILED');
      request.log.warn({ err: message }, 'preview update failed');
      const status = ['IMPORT_CONCURRENCY_LIMIT','USER_STORAGE_QUOTA_LIMIT','TOTAL_STORAGE_QUOTA_LIMIT'].includes(message) ? 429 : message.startsWith('SOURCE_URL_') ? 400 : 422;
      return reply.code(status).send({ error: message });
    }
  });

  app.post('/api/previews/:id/extend', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { lifetimeMinutes?: unknown };
    const parsed = extendInputSchema(config).safeParse({ previewId: id, lifetimeMinutes: body.lifetimeMinutes });
    if (!parsed.success) return reply.code(400).send({ error: validationError(parsed) });
    try {
      const preview = await service.extendOwned(request.authContext!.userId, parsed.data.previewId, parsed.data.lifetimeMinutes);
      if (!preview) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
      return toPreviewOutput(preview);
    } catch (error) {
      const message = errorCode(error, 'PREVIEW_EXTEND_FAILED');
      return reply.code(message === 'INVALID_TTL' || message === 'INVALID_EXTENSION' ? 400 : 422).send({ error: message });
    }
  });

  app.delete('/api/previews/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = previewIdSchema.safeParse(id);
    if (!parsedId.success) return reply.code(400).send({ error: validationError(parsedId) });
    const deleted = await service.deleteOwned(request.authContext!.userId, parsedId.data);
    if (!deleted) return reply.code(404).send({ error: 'PREVIEW_NOT_FOUND' });
    return reply.code(204).send();
  });

  app.post('/api/previews', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.isMultipart()) {
      const body = (request.body ?? {}) as { sourceUrl?: unknown; lifetimeMinutes?: unknown; name?: unknown };
      if (body.sourceUrl === undefined) return reply.code(400).send({ error: 'SOURCE_URL_REQUIRED' });
      const parsed = createUrlInputSchema(config).safeParse(body);
      if (!parsed.success) return reply.code(400).send({ error: validationError(parsed) });
      try {
        const preview = await service.createFromUrl({
          ownerUserId: request.authContext!.userId,
          sourceUrl: parsed.data.sourceUrl,
          ...(parsed.data.lifetimeMinutes !== undefined ? { lifetimeMinutes: parsed.data.lifetimeMinutes } : {}),
          ...(parsed.data.name !== undefined ? { displayName: parsed.data.name } : {}),
        });
        return reply.code(201).send(toPreviewOutput(preview));
      } catch (error) {
        request.log.warn({ err: error instanceof Error ? error.message : 'url import failed' }, 'preview URL creation failed');
        const message = errorCode(error, 'PREVIEW_CREATE_FAILED');
        const status = ['ACTIVE_PREVIEW_LIMIT','IMPORT_CONCURRENCY_LIMIT','USER_STORAGE_QUOTA_LIMIT','TOTAL_STORAGE_QUOTA_LIMIT'].includes(message) ? 429 : message === 'INVALID_TTL' || message.startsWith('SOURCE_URL_') ? 400 : 422;
        return reply.code(status).send({ error: message });
      }
    }
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'ARTIFACT_REQUIRED' });
    const lifetimeRaw = multipartFieldValue(part.fields as unknown as Record<string, unknown>, 'lifetimeMinutes');
    const nameRaw = multipartFieldValue(part.fields as unknown as Record<string, unknown>, 'name');
    const lifetimeResult = lifetimeRaw === undefined ? undefined : lifetimeMinutesSchema(config).safeParse(Number(lifetimeRaw));
    if (lifetimeResult && !lifetimeResult.success) return reply.code(400).send({ error: validationError(lifetimeResult) });
    const nameResult = nameRaw === undefined ? undefined : previewNameSchema.safeParse(nameRaw);
    if (nameResult && !nameResult.success) return reply.code(400).send({ error: validationError(nameResult) });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-upload-'));
    const archivePath = path.join(dir, 'artifact');
    try {
      await pipeline(part.file, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
      if (part.file.truncated) throw new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT');
      const preview = await service.createFromFile({
        ownerUserId: request.authContext!.userId,
        archivePath,
        ...(lifetimeResult ? { lifetimeMinutes: lifetimeResult.data } : {}),
        ...(nameResult ? { displayName: nameResult.data } : {}),
      });
      return reply.code(201).send(toPreviewOutput(preview));
    } catch (error) {
      request.log.warn({ err: error }, 'preview creation failed');
      const message = errorCode(error, 'PREVIEW_CREATE_FAILED');
      const status = ['ACTIVE_PREVIEW_LIMIT','IMPORT_CONCURRENCY_LIMIT','USER_STORAGE_QUOTA_LIMIT','TOTAL_STORAGE_QUOTA_LIMIT'].includes(message) ? 429 : message === 'INVALID_TTL' ? 400 : 422;
      return reply.code(status).send({ error: message });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

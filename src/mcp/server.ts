import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod/v4';
import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/db.js';
import type { PreviewService } from '../preview/preview-service.js';
import { requireAuth } from '../auth/auth-plugin.js';
import { McpTokenService } from './token-service.js';
import { ApplicationError } from '../errors/application-error.js';
import { toPreviewOutput } from '../preview/preview-output.js';


function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

export function createMcpHttpHandler(service: PreviewService, userId: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'pwa-preview', version: '0.1.0' });

    server.registerTool('preview_create', {
      description: 'Create a temporary preview from an HTTPS URL pointing to a ZIP or tar.gz static artifact.',
      inputSchema: z.object({
        sourceUrl: z.string().url(),
        lifetimeMinutes: z.number().int().optional(),
        name: z.string().trim().min(1).max(200).optional(),
      }),
    }, async ({ sourceUrl, lifetimeMinutes, name }) => {
      const preview = await service.createFromUrl({
        ownerUserId: userId,
        sourceUrl,
        ...(lifetimeMinutes !== undefined ? { lifetimeMinutes } : {}),
        ...(name !== undefined ? { displayName: name } : {}),
      });
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_list', {
      description: 'List previews owned by the authenticated user.',
      inputSchema: z.object({}),
    }, async () => result({ previews: (await service.listOwned(userId)).map(toPreviewOutput) }));

    server.registerTool('preview_get', {
      description: 'Get one preview owned by the authenticated user.',
      inputSchema: z.object({ previewId: z.string().min(1) }),
    }, async ({ previewId }) => {
      const preview = await service.getOwned(userId, previewId);
      if (!preview) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_update', {
      description: 'Replace the content of an owned preview from an HTTPS artifact URL while keeping the same preview URL.',
      inputSchema: z.object({ previewId: z.string().min(1), sourceUrl: z.string().url() }),
    }, async ({ previewId, sourceUrl }) => {
      const preview = await service.updateFromUrl({ ownerUserId: userId, previewId, sourceUrl });
      if (!preview) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_extend', {
      description: 'Extend the lifetime of an owned preview.',
      inputSchema: z.object({ previewId: z.string().min(1), lifetimeMinutes: z.number().int() }),
    }, async ({ previewId, lifetimeMinutes }) => {
      const preview = await service.extendOwned(userId, previewId, lifetimeMinutes);
      if (!preview) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_delete', {
      description: 'Delete an owned preview.',
      inputSchema: z.object({ previewId: z.string().min(1) }),
    }, async ({ previewId }) => {
      const deleted = await service.deleteOwned(userId, previewId);
      if (!deleted) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result({ previewId, deleted: true });
    });

    return server;
  });
}

export async function registerMcp(app: FastifyInstance, config: AppConfig, pool: DatabasePool, service: PreviewService): Promise<void> {
  const tokens = new McpTokenService(pool);

  app.post('/api/mcp-tokens', { preHandler: requireAuth }, async (request, reply) => {
    const body = (request.body ?? {}) as { days?: unknown };
    try {
      const issued = await tokens.issue(request.authContext!.userId, body.days === undefined ? undefined : Number(body.days));
      return reply.code(201).send({ token: issued.token, expiresAt: issued.expiresAt.toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TOKEN_CREATE_FAILED';
      return reply.code(message === 'INVALID_TOKEN_LIFETIME' ? 400 : 422).send({ error: message });
    }
  });

  app.delete('/api/mcp-tokens', { preHandler: requireAuth }, async (request) => ({ revoked: await tokens.revokeAll(request.authContext!.userId) }));

  app.all('/mcp', async (request, reply) => {
    const host = (request.headers.host ?? '').split(':')[0]?.toLowerCase();
    if (host !== config.controlPlaneHost.toLowerCase()) return reply.code(404).send({ error: 'NOT_FOUND' });
    const userId = await tokens.authenticate(request.headers.authorization);
    if (!userId) return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'INVALID_MCP_TOKEN' });
    const handler = createMcpHttpHandler(service, userId);
    const node = toNodeHandler(handler);
    return node(request.raw as any, reply.raw as any, request.body);
  });
}

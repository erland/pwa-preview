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
import { createUrlInputSchema, extendInputSchema, previewIdSchema, updateUrlInputSchema } from '../preview/preview-input.js';


function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

const PWA_PREVIEW_DESCRIPTION =
  'Deploys and manages temporary HTTPS previews of pre-built static web applications and PWAs.';
const PWA_PREVIEW_WEBSITE = 'https://pwa-preview.apphome.one/about';
const PWA_PREVIEW_ICON_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACG0lEQVR42u2bsU7DMBRFbxEDewekzGVJP4KFAakDO2v+Ab6h/ENXdgakDix8BF1grsTA3q0M6JXEtds8O/V7cXyW1mms+F5fPzeDR9vtFkPmTHoA0pxzbi4r9CYuqwVGbe4btVkCfRJucsyIgwb0WbiJywhnDUhJPODWYzUgNfGETdeeAamKJ0x9g98GGwakPvtEXWdOAH0ZyuwTpDcnQHoA0rDeBd6e/j6Lx9vdtfV8ieLj4r893eDu837Xfrl6Dhwin5uH9veyE1AXD6AhHkBDvK2tjcEvgWwAt8N6vmy2p5tG21zzEjWAA6sIElwTNMMyoBifahhy5BogPQBpsgHSA5AmugFlFfuJhxFJQFnpMUJ0CWgwQbwGSKdB3ABCygg1BhCxTVBnABA3DV4vQ6dmtYj3LHUJiCkeUJSA2MIJcQOkhBOiS0BaPCCUAK7w8WS2d+3n67WTsUQ3gCPeJtz8LdQIdbsAcUi8z30uVBrgirxrtkNMUGeArxjffqoMCI2zT3+WARre34/BHSN7Fygr2f3brAOhqfHaBiWSMJ7MOtv764j/FeYQOts2VBVBCVQZcHkdFnGf/qoMAPxN8O2nzgCALyYkOSoNANqLCl02qncBEvf9vl/9Q4UTqg0guhJrY7cE2p6xSQXSq7YGxKJhwFBSUNeZE2BeSD0Fpj5rAlI1wabLuQRSM8GlJ58c5Zwe75MRnZ4dTplfR+OTt6Lc/vgAAAAASUVORK5CYII=';

export function createMcpHttpHandler(service: PreviewService, userId: string, config: AppConfig) {
  return createMcpHandler(() => {
    const server = new McpServer({
      name: 'pwa-preview',
      title: 'PWA Preview',
      version: process.env.PWA_PREVIEW_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      description: PWA_PREVIEW_DESCRIPTION,
      websiteUrl: PWA_PREVIEW_WEBSITE,
      icons: [{
        src: PWA_PREVIEW_ICON_DATA_URI,
        mimeType: 'image/png',
        sizes: ['64x64'],
      }],
    });

    server.registerTool('preview_create', {
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      description: 'Create a temporary preview from an HTTPS URL pointing to a ZIP or tar.gz static artifact.',
      inputSchema: createUrlInputSchema(config),
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
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      description: 'List previews owned by the authenticated user.',
      inputSchema: z.object({}),
    }, async () => result({ previews: (await service.listOwned(userId)).map(toPreviewOutput) }));

    server.registerTool('preview_get', {
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      description: 'Get one preview owned by the authenticated user.',
      inputSchema: z.object({ previewId: previewIdSchema }),
    }, async ({ previewId }) => {
      const preview = await service.getOwned(userId, previewId);
      if (!preview) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_update', {
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      description: 'Replace the content of an owned preview from an HTTPS artifact URL while keeping the same preview URL.',
      inputSchema: updateUrlInputSchema(),
    }, async ({ previewId, sourceUrl }) => {
      const preview = await service.updateFromUrl({ ownerUserId: userId, previewId, sourceUrl });
      if (!preview) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_extend', {
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      description: 'Extend the lifetime of an owned preview.',
      inputSchema: extendInputSchema(config),
    }, async ({ previewId, lifetimeMinutes }) => {
      const preview = await service.extendOwned(userId, previewId, lifetimeMinutes);
      if (!preview) throw new ApplicationError('PREVIEW_NOT_FOUND');
      return result(toPreviewOutput(preview));
    });

    server.registerTool('preview_delete', {
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
      description: 'Delete an owned preview.',
      inputSchema: z.object({ previewId: previewIdSchema }),
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
    if (!userId) {
      const resourceMetadata = `https://${config.controlPlaneHost}/.well-known/oauth-protected-resource/mcp`;
      return reply.code(401).header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"`).send({ error: 'INVALID_MCP_TOKEN' });
    }
    const handler = createMcpHttpHandler(service, userId, config);
    const node = toNodeHandler(handler);
    return node(request.raw as any, reply.raw as any, request.body);
  });
}

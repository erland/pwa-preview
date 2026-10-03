import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './persistence/db.js';
import { registerAuth } from './auth/auth-plugin.js';
import type { GithubClient } from './auth/github-client.js';
import { registerPreviewHttp } from './preview/preview-http-plugin.js';
import { registerUi } from './ui/ui-plugin.js';
import { registerMcp } from './mcp/server.js';
import { classifyRequestPlane } from './http-host-policy.js';

export type BuildAppOptions = Readonly<{
  config?: AppConfig;
  pool?: DatabasePool;
  githubClient?: GithubClient;
}>;

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    if (!options.config || !options.pool) return { status: 'ready' };
    try {
      await options.pool.query('SELECT 1');
      await access(options.config.dataRoot, fsConstants.R_OK | fsConstants.W_OK);
      return { status: 'ready' };
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'not-ready' });
    }
  });

  if (options.config && options.pool) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url === '/health' || request.url === '/ready') return;
      const plane = classifyRequestPlane(request.headers.host, options.config!.controlPlaneHost, options.config!.previewDomainSuffix);
      if (plane === 'UNKNOWN') await reply.code(404).send({ error: 'HOST_NOT_FOUND' });
    });

    void app.register(async (scope) => {
      await registerAuth(scope, {
        config: options.config!,
        pool: options.pool!,
        ...(options.githubClient ? { githubClient: options.githubClient } : {}),
      });
      await registerPreviewHttp(scope, options.config!, options.pool!);
      await registerMcp(scope, options.config!, options.pool!);
      await registerUi(scope);
    });
  }
  return app;
}

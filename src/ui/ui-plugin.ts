import path from 'node:path';
import staticPlugin from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerUi(app: FastifyInstance): Promise<void> {
  const root = path.resolve('dist/ui');
  const assetsRoot = path.join(root, 'assets');
  await app.register(staticPlugin, { root: assetsRoot, prefix: '/assets/' });
  const renderIndex = async (_request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => reply.type('text/html').sendFile('index.html', root);
  app.get('/', renderIndex);
  app.get('/settings', renderIndex);
}

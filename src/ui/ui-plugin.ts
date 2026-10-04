import path from 'node:path';
import staticPlugin from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerUi(app: FastifyInstance): Promise<void> {
  const root = path.resolve('dist/ui');
  await app.register(staticPlugin, { root, prefix: '/assets/' });
  app.get('/', async (_request, reply) => reply.type('text/html').sendFile('index.html', root));
}

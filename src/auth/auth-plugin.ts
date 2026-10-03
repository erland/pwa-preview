import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import secureSession from '@fastify/secure-session';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/db.js';
import type { AuthContext } from './auth-context.js';
import { GithubHttpClient, type GithubClient } from './github-client.js';
import { AccessDeniedError, UserService } from '../users/user-service.js';

declare module 'fastify' {
  interface FastifyRequest { authContext: AuthContext | null; }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    userId?: string;
    oauthStateHash?: string;
  }
}

export type AuthPluginOptions = Readonly<{
  config: AppConfig;
  pool: DatabasePool;
  githubClient?: GithubClient;
}>;

function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export async function registerAuth(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  const key = createHash('sha256').update(options.config.sessionSecret).digest();
  await app.register(secureSession, {
    key,
    cookieName: 'pwa_preview_session',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      // Deliberately no Domain: this is a host-only control-plane cookie.
    },
  });

  const github = options.githubClient ?? new GithubHttpClient(options.config.githubClientId, options.config.githubClientSecret);
  const users = new UserService(options.pool);

  app.decorateRequest('authContext', null);
  app.addHook('preHandler', async (request) => {
    const userId = request.session.get('userId');
    request.authContext = typeof userId === 'string' ? { userId } : null;
  });

  app.get('/auth/login/github', async (request, reply) => {
    const state = randomBytes(24).toString('base64url');
    request.session.set('oauthStateHash', stateHash(state));
    const callback = `https://${options.config.controlPlaneHost}/auth/callback/github`;
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', options.config.githubClientId);
    authorize.searchParams.set('redirect_uri', callback);
    authorize.searchParams.set('scope', 'read:user user:email');
    authorize.searchParams.set('state', state);
    return reply.redirect(authorize.toString());
  });

  app.get('/auth/callback/github', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    const expectedHash = request.session.get('oauthStateHash');
    if (!query.code || !query.state || typeof expectedHash !== 'string') return reply.code(400).send({ error: 'INVALID_OAUTH_CALLBACK' });
    const actual = Buffer.from(stateHash(query.state));
    const expected = Buffer.from(expectedHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(400).send({ error: 'INVALID_OAUTH_STATE' });

    try {
      const token = await github.exchangeCode(query.code);
      const identity = await github.fetchIdentity(token);
      const { userId } = await users.loginWithGithub(identity);
      request.session.set('userId', userId);
      return reply.redirect('/');
    } catch (error) {
      if (error instanceof AccessDeniedError) return reply.code(403).send({ error: error.message });
      request.log.warn({ err: error }, 'github oauth callback failed');
      return reply.code(401).send({ error: 'AUTHENTICATION_FAILED' });
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    request.session.delete();
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: requireAuth }, async (request) => ({ userId: request.authContext!.userId }));
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authContext) await reply.code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
}

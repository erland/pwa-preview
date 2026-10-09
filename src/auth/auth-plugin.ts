import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import secureSession from '@fastify/secure-session';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/db.js';
import type { AuthContext } from './auth-context.js';
import { GithubHttpClient, type GithubClient } from './github-client.js';
import { GoogleOidcClient } from './google-client.js';
import { IdentityRepository } from '../persistence/repositories/identity-repository.js';
import { AccessDeniedError, UserService } from '../users/user-service.js';

declare module 'fastify' {
  interface FastifyRequest { authContext: AuthContext | null; }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    userId?: string;
    oauthStateHash?: string;
    oauthReturnTo?: string;
    oauthProvider?: string;
    oauthVerifier?: string;
    oauthLinkUserId?: string;
    mergeDestinationId?: string;
    mergeSourceId?: string;
    mergeProvider?: string;
    mergeSubject?: string;
    mergeExpiresAt?: number;
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
  const identities = new IdentityRepository(options.pool);
  const clearMerge = (request: FastifyRequest) => {
    for (const key of ['mergeDestinationId', 'mergeSourceId', 'mergeProvider', 'mergeSubject', 'mergeExpiresAt'] as const) request.session.set(key, undefined);
  };
  const stageMerge = async (request: FastifyRequest, linkUserId: string, provider: 'github' | 'google', subject: string) => {
    const conflict = await identities.findByProviderSubject(provider, subject);
    if (!conflict || conflict.userId === linkUserId) return false;
    clearMerge(request);
    request.session.set('mergeDestinationId', linkUserId);
    request.session.set('mergeSourceId', conflict.userId);
    request.session.set('mergeProvider', provider);
    request.session.set('mergeSubject', subject);
    request.session.set('mergeExpiresAt', Date.now() + 5 * 60_000);
    return true;
  };
  const pendingMerge = (request: FastifyRequest) => {
    const destinationId = request.session.get('mergeDestinationId');
    const sourceId = request.session.get('mergeSourceId');
    const provider = request.session.get('mergeProvider');
    const subject = request.session.get('mergeSubject');
    const expiry = request.session.get('mergeExpiresAt');
    if (typeof destinationId !== 'string' || destinationId !== request.authContext?.userId || typeof sourceId !== 'string' || (provider !== 'github' && provider !== 'google') || typeof subject !== 'string' || typeof expiry !== 'number' || Date.now() >= expiry) return null;
    return { destinationId, sourceId, provider, subject };
  };

  const google = options.config.googleClientId && options.config.googleClientSecret ? new GoogleOidcClient(options.config.googleClientId, options.config.googleClientSecret) : null;

  app.decorateRequest('authContext', null);
  app.addHook('preHandler', async (request) => {
    const userId = request.session.get('userId');
    if (typeof userId !== 'string') {
      request.authContext = null;
      return;
    }
    if (!(await users.isUserAllowed(userId))) {
      request.session.delete();
      request.authContext = null;
      return;
    }
    request.authContext = { userId };
  });

  app.get('/api/auth/providers', async () => ({ github: true, google: Boolean(google) }));

  app.get('/auth/login/github', async (request, reply) => {
    const query = request.query as { returnTo?: string; link?: string };
    request.session.set('oauthReturnTo', query.returnTo?.startsWith('/authorize?') ? query.returnTo : '');
    const state = randomBytes(24).toString('base64url');
    clearMerge(request);
    request.session.set('oauthStateHash', stateHash(state));
    request.session.set('oauthProvider', 'github');
    const linkUserId = query.link === 'true' ? request.authContext?.userId : undefined;
    if (query.link === 'true' && !linkUserId) return reply.code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
    request.session.set('oauthLinkUserId', linkUserId ?? '');
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
    if (request.session.get('oauthProvider') !== 'github') return reply.code(400).send({ error: 'INVALID_OAUTH_PROVIDER' });
    request.session.set('oauthStateHash', '');
    const actual = Buffer.from(stateHash(query.state));
    const expected = Buffer.from(expectedHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(400).send({ error: 'INVALID_OAUTH_STATE' });

    const linkUserId = request.session.get('oauthLinkUserId');
    request.session.set('oauthLinkUserId', '');
    if (linkUserId && request.authContext?.userId !== linkUserId) return reply.code(401).send({ error: 'LINK_SESSION_EXPIRED' });
    try {
      const token = await github.exchangeCode(query.code);
      const identity = await github.fetchIdentity(token);
      const linked = linkUserId ? await identities.findByProviderSubject('github', identity.subject) : null;
      if (linkUserId && linked && linked.userId !== linkUserId) {
        await stageMerge(request, linkUserId, 'github', identity.subject);
        return reply.redirect('/?merge=review');
      }
      const { userId } = await users.loginWithProvider('github', identity, linkUserId || undefined);
      request.session.set('userId', userId);
      const returnTo = request.session.get('oauthReturnTo');
      request.session.set('oauthReturnTo', '');
      return reply.redirect(typeof returnTo === 'string' && returnTo.startsWith('/authorize?') ? returnTo : '/');
    } catch (error) {
      if (error instanceof AccessDeniedError) return reply.code(403).send({ error: error.message });
      if (error instanceof Error && error.message === 'IDENTITY_ALREADY_LINKED') return reply.code(409).send({ error: error.message });
      request.log.warn({ err: error }, 'github oauth callback failed');
      return reply.code(401).send({ error: 'AUTHENTICATION_FAILED' });
    }
  });


  app.get('/auth/login/google', async (request, reply) => {
    if (!google || !options.config.googleClientId) return reply.code(404).send({ error: 'GOOGLE_LOGIN_DISABLED' });
    const query = request.query as { returnTo?: string; link?: string };
    const linking = query.link === 'true';
    const userId = linking ? request.authContext?.userId : undefined;
    if (linking && !userId) return reply.code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    clearMerge(request);
    request.session.set('oauthStateHash', stateHash(state));
    request.session.set('oauthProvider', 'google');
    request.session.set('oauthVerifier', verifier);
    request.session.set('oauthLinkUserId', userId ?? '');
    request.session.set('oauthReturnTo', query.returnTo?.startsWith('/authorize?') ? query.returnTo : '');
    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.searchParams.set('client_id', options.config.googleClientId);
    authorize.searchParams.set('redirect_uri', 'https://' + options.config.controlPlaneHost + '/auth/callback/google');
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'openid email profile');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    return reply.redirect(authorize.toString());
  });

  app.get('/auth/callback/google', async (request, reply) => {
    if (!google) return reply.code(404).send({ error: 'GOOGLE_LOGIN_DISABLED' });
    const query = request.query as { code?: string; state?: string };
    const expected = request.session.get('oauthStateHash');
    const verifier = request.session.get('oauthVerifier');
    if (!query.code || !query.state || typeof expected !== 'string' || !expected || typeof verifier !== 'string' || request.session.get('oauthProvider') !== 'google') return reply.code(400).send({ error: 'INVALID_OAUTH_CALLBACK' });
    request.session.set('oauthStateHash', '');
    request.session.set('oauthVerifier', '');
    request.session.set('oauthProvider', '');
    if (!timingSafeEqual(Buffer.from(stateHash(query.state)), Buffer.from(expected))) return reply.code(400).send({ error: 'INVALID_OAUTH_STATE' });
    const linkUserId = request.session.get('oauthLinkUserId');
    request.session.set('oauthLinkUserId', '');
    if (linkUserId && request.authContext?.userId !== linkUserId) return reply.code(401).send({ error: 'LINK_SESSION_EXPIRED' });
    try {
      const identity = await google.exchangeCode(query.code, 'https://' + options.config.controlPlaneHost + '/auth/callback/google', verifier);
      const linked = linkUserId ? await identities.findByProviderSubject('google', identity.subject) : null;
      if (linkUserId && linked && linked.userId !== linkUserId) {
        await stageMerge(request, linkUserId, 'google', identity.subject);
        return reply.redirect('/?merge=review');
      }
      const { userId } = await users.loginWithProvider('google', identity, linkUserId || undefined);
      request.session.set('userId', userId);
      const returnTo = request.session.get('oauthReturnTo');
      request.session.set('oauthReturnTo', '');
      return reply.redirect(typeof returnTo === 'string' && returnTo.startsWith('/authorize?') ? returnTo : '/');
    } catch (error) {
      if (error instanceof AccessDeniedError) return reply.code(403).send({ error: error.message });
      if (error instanceof Error && error.message === 'IDENTITY_ALREADY_LINKED') return reply.code(409).send({ error: error.message });
      request.log.warn({ err: error }, 'google oauth callback failed');
      return reply.code(401).send({ error: 'AUTHENTICATION_FAILED' });
    }
  });

  app.get('/api/account-merge', { preHandler: requireAuth }, async (request, reply) => {
    const pending = pendingMerge(request);
    if (!pending) return reply.code(404).send({ error: 'NO_PENDING_MERGE' });
    const summary = await users.getMergePreview(pending.destinationId, pending.sourceId);
    if (!summary) return reply.code(409).send({ error: 'INVALID_MERGE' });
    return { provider: pending.provider, ...summary };
  });

  app.post('/api/account-merge/cancel', { preHandler: requireAuth }, async (request, reply) => {
    if (request.headers.origin !== 'https://' + options.config.controlPlaneHost) return reply.code(403).send({ error: 'INVALID_REQUEST_ORIGIN' });
    clearMerge(request);
    return reply.code(204).send();
  });

  app.post('/api/account-merge/confirm', { preHandler: requireAuth }, async (request, reply) => {
    if (request.headers.origin !== 'https://' + options.config.controlPlaneHost) return reply.code(403).send({ error: 'INVALID_REQUEST_ORIGIN' });
    const pending = pendingMerge(request);
    if (!pending) return reply.code(409).send({ error: 'MERGE_EXPIRED' });
    try {
      await users.mergeAccounts(pending.destinationId, pending.sourceId, pending.provider, pending.subject,
        { active: options.config.maxActivePreviewsPerUser, permanent: 10, storage: options.config.maxStorageBytesPerUser });
      clearMerge(request);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && ['MERGE_LIMIT_EXCEEDED', 'MERGE_ACCOUNT_CHANGED'].includes(error.message)) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    request.session.delete();
    return reply.code(204).send();
  });

  app.delete('/api/me/identities/:provider', { preHandler: requireAuth }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (provider !== 'github' && provider !== 'google') return reply.code(400).send({ error: 'UNSUPPORTED_IDENTITY_PROVIDER' });

    // A state-changing, cookie-authenticated request must originate from the control plane.
    const origin = request.headers.origin;
    if (origin !== 'https://' + options.config.controlPlaneHost) {
      return reply.code(403).send({ error: 'INVALID_REQUEST_ORIGIN' });
    }
    const result = await users.unlinkProvider(request.authContext!.userId, provider);
    if (result === 'not_found') return reply.code(404).send({ error: 'IDENTITY_NOT_LINKED' });
    if (result === 'last_identity') return reply.code(409).send({ error: 'LAST_LOGIN_METHOD' });
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: requireAuth }, async (request) => {
    const userId = request.authContext!.userId;
    const result = await options.pool.query<{ provider: string; email: string | null }>(
      'SELECT provider, email FROM external_identities WHERE user_id = $1 AND email_verified = true ORDER BY provider',
      [userId],
    );
    return { userId, identities: result.rows.map(({ provider, email }) => ({ provider, email })) };
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authContext) await reply.code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
}

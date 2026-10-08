import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { DatabasePool } from '../persistence/db.js';
import { OAuthStore } from './oauth-store.js';
import { McpTokenService } from './token-service.js';

const REQUIRED_SCOPE = 'mcp';
const ACCESS_TOKEN_SECONDS = 60 * 60;
const REFRESH_TOKEN_DAYS = 30;
const CODE_TTL_MS = 5 * 60_000;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(prefix: string): string {
  return prefix + randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function oauthError(reply: any, error: string, description: string, status = 400) {
  return reply.code(status).header('cache-control', 'no-store').send({ error, error_description: description });
}

function safeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

function requestPath(request: FastifyRequest): string {
  return request.raw.url && request.raw.url.startsWith('/') ? request.raw.url : '/authorize';
}

export async function registerMcpOAuth(app: FastifyInstance, config: AppConfig, pool: DatabasePool): Promise<void> {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); }
    catch (error) { done(error as Error, undefined); }
  });
  const issuer = `https://${config.controlPlaneHost}`;
  const mcpUrl = `${issuer}/mcp`;
  const metadataUrl = `${issuer}/.well-known/oauth-protected-resource/mcp`;
  const store = new OAuthStore(pool);
  const tokens = new McpTokenService(pool);

  const authorizationServerMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    scopes_supported: [REQUIRED_SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };

  const protectedResourceMetadata = {
    resource: mcpUrl,
    authorization_servers: [issuer],
    scopes_supported: [REQUIRED_SCOPE],
    bearer_methods_supported: ['header'],
  };

  app.get('/.well-known/oauth-authorization-server', async (_request, reply) =>
    reply.header('access-control-allow-origin', '*').send(authorizationServerMetadata));

  app.get('/.well-known/oauth-protected-resource', async (_request, reply) =>
    reply.header('access-control-allow-origin', '*').send(protectedResourceMetadata));

  app.get('/.well-known/oauth-protected-resource/mcp', async (_request, reply) =>
    reply.header('access-control-allow-origin', '*').send(protectedResourceMetadata));

  app.post('/register', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v): v is string => typeof v === 'string') : [];
    if (redirectUris.length === 0 || redirectUris.length > 10 || redirectUris.some((uri) => !safeRedirectUri(uri))) {
      return oauthError(reply, 'invalid_redirect_uri', 'redirect_uris are missing or invalid');
    }
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
      return oauthError(reply, 'invalid_client_metadata', 'Only public PKCE clients are supported');
    }
    const clientName = typeof body.client_name === 'string' ? body.client_name.trim().slice(0, 200) : undefined;
    const clientId = randomToken('pwc_');
    await store.registerClient({ clientId, redirectUris, ...(clientName ? { clientName } : {}) });
    return reply.code(201).header('cache-control', 'no-store').send({
      client_id: clientId,
      redirect_uris: redirectUris,
      ...(clientName ? { client_name: clientName } : {}),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  app.get('/authorize', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query.response_type !== 'code') return oauthError(reply, 'unsupported_response_type', 'Only response_type=code is supported');
    const clientId = query.client_id ?? '';
    const redirectUri = query.redirect_uri ?? '';
    const scope = (query.scope ?? REQUIRED_SCOPE).trim();
    const resource = query.resource ?? mcpUrl;
    const codeChallenge = query.code_challenge ?? '';
    if (!clientId || !redirectUri) return oauthError(reply, 'invalid_request', 'client_id and redirect_uri are required');
    if (resource !== mcpUrl) return oauthError(reply, 'invalid_target', 'resource must be the MCP endpoint');
    if (!scope.split(/\s+/).includes(REQUIRED_SCOPE)) return oauthError(reply, 'invalid_scope', 'Required mcp scope is missing');
    if (!codeChallenge || query.code_challenge_method !== 'S256') return oauthError(reply, 'invalid_request', 'PKCE S256 is required');

    const client = await store.findClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return oauthError(reply, 'invalid_request', 'Unknown client or redirect_uri');
    }

    if (!request.authContext) {
      const returnTo = requestPath(request);
      return reply.redirect(`/auth/login/github?returnTo=${encodeURIComponent(returnTo)}`);
    }

    const code = randomToken('pwc_code_');
    await store.saveAuthorizationCode({
      codeHash: hash(code),
      clientId,
      userId: request.authContext.userId,
      redirectUri,
      scope,
      resource,
      codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    const destination = new URL(redirectUri);
    destination.searchParams.set('code', code);
    if (query.state) destination.searchParams.set('state', query.state);
    destination.searchParams.set('iss', issuer);
    return reply.redirect(destination.toString());
  });

  app.post('/token', async (request, reply) => {
    const contentType = String(request.headers['content-type'] ?? '');
    if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
      return oauthError(reply, 'invalid_request', 'Token endpoint requires form encoding');
    }
    const form = request.body as Record<string, string | undefined>;
    const grantType = form.grant_type ?? '';

    if (grantType === 'authorization_code') {
      const code = form.code ?? '';
      const clientId = form.client_id ?? '';
      const redirectUri = form.redirect_uri ?? '';
      const verifier = form.code_verifier ?? '';
      if (!code || !clientId || !redirectUri || !verifier) return oauthError(reply, 'invalid_request', 'Missing authorization code parameters');
      const record = await store.consumeAuthorizationCode(hash(code));
      if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri) {
        return oauthError(reply, 'invalid_grant', 'Authorization code is invalid or expired');
      }
      if (pkceChallenge(verifier) !== record.codeChallenge) return oauthError(reply, 'invalid_grant', 'PKCE verification failed');
      if (form.resource && form.resource !== record.resource) return oauthError(reply, 'invalid_target', 'Resource mismatch');
      return issueOAuthTokens(reply, store, tokens, record.clientId, record.userId, record.scope, record.resource);
    }

    if (grantType === 'refresh_token') {
      const startedAt = Date.now();
      const diagnostic = (outcome: 'success' | 'rejected' | 'error', reason: string) => {
        app.log.info({
          event: 'oauth.refresh',
          request_id: request.id,
          outcome,
          reason,
          duration_ms: Date.now() - startedAt,
        }, 'MCP OAuth refresh');
      };
      const refreshToken = form.refresh_token ?? '';
      const clientId = form.client_id ?? '';
      if (!refreshToken || !clientId) {
        diagnostic('rejected', 'missing_parameters');
        return oauthError(reply, 'invalid_request', 'Missing refresh token parameters');
      }
      try {
        const record = await store.consumeRefreshToken(hash(refreshToken), clientId, form.resource);
        if (!record || record.clientId !== clientId) {
          diagnostic('rejected', 'invalid_grant');
          return oauthError(reply, 'invalid_grant', 'Refresh token is invalid or expired');
        }
        if (form.resource && form.resource !== record.resource) {
          diagnostic('rejected', 'resource_mismatch');
          return oauthError(reply, 'invalid_target', 'Resource mismatch');
        }
        const response = await issueOAuthTokens(reply, store, tokens, record.clientId, record.userId, record.scope, record.resource, refreshToken, config.sessionSecret);
        diagnostic('success', 'rotated_or_retried');
        return response;
      } catch (error) {
        diagnostic('error', 'internal_error');
        throw error;
      }
    }

    return oauthError(reply, 'unsupported_grant_type', 'Unsupported grant_type');
  });

}

async function issueOAuthTokens(
  reply: any,
  store: OAuthStore,
  tokens: McpTokenService,
  clientId: string,
  userId: string,
  scope: string,
  resource: string,
  predecessor?: string,
  signingSecret?: string,
) {
  const access = await tokens.issueForSeconds(userId, ACCESS_TOKEN_SECONDS);
  const refreshToken = predecessor && signingSecret
    ? 'pwr_' + createHmac('sha256', signingSecret).update('oauth-refresh-successor-v1:').update(predecessor).digest('base64url')
    : randomToken('pwr_');
  await store.saveRefreshToken({
    tokenHash: hash(refreshToken),
    clientId,
    userId,
    scope,
    resource,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60_000),
  });
  return reply.header('cache-control', 'no-store').send({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    scope,
  });
}

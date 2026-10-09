import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import type { DatabasePool } from '../../src/persistence/db.js';

const config: AppConfig = {
  controlPlaneHost: 'pwa-preview.example.com', controlPlaneRegistrableDomain: 'example.com', previewDomainSuffix: 'preview.example.net', databaseUrl: 'postgres://unused', dataRoot: '/tmp/pwa-preview-auth-test',
  sessionSecret: '0123456789012345678901234567890123456789', githubClientId: 'client', githubClientSecret: 'secret',
  ttlMinMinutes: 5, ttlDefaultMinutes: 30, ttlMaxMinutes: 1440, maxCompressedBytes: 1, maxExtractedBytes: 2,
  maxFileCount: 3, maxPathLength: 1024, urlFetchTimeoutMs: 30000, maxRedirects: 5,
  maxActivePreviewsPerUser:20, maxConcurrentImportsPerUser:2,
  maxStorageBytesPerUser:2147483648, maxStorageBytesTotal:21474836480,
  cleanupIntervalMs: 60000, reconciliationIntervalMs: 600000, staleOperationMinutes: 30, staleStagingMinutes: 60, migrateOnStart: true,
};

const unusedPool = { query: async () => ({ rows: [] }), connect: async () => { throw new Error('unused'); } } as unknown as DatabasePool;

describe('auth routes', () => {
  it('starts GitHub OAuth with expected scope and host-only secure session cookie', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const response = await app.inject({ method: 'GET', url: '/auth/login/github', headers: { host: config.controlPlaneHost } });
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('scope')).toBe('read:user user:email');
    expect(location.searchParams.get('redirect_uri')).toBe('https://pwa-preview.example.com/auth/callback/github');
    const cookie = response.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).not.toContain('Domain=');
    await app.close();
  });

  it('exposes enabled providers and disables Google when unconfigured', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const providers = await app.inject({ method: 'GET', url: '/api/auth/providers', headers: { host: config.controlPlaneHost } });
    expect(providers.json()).toEqual({ github: true, google: false });
    const google = await app.inject({ method: 'GET', url: '/auth/login/google', headers: { host: config.controlPlaneHost } });
    expect(google.statusCode).toBe(404);
    await app.close();
  });

  it('starts Google OAuth with PKCE, scoped identity and dedicated callback when configured', async () => {
    const enabled = { ...config, googleClientId: 'google-client', googleClientSecret: 'google-secret' };
    const app = buildApp({ config: enabled, pool: unusedPool });
    const response = await app.inject({ method: 'GET', url: '/auth/login/google', headers: { host: config.controlPlaneHost } });
    expect(response.statusCode).toBe(302);
    const url = new URL(response.headers.location!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe('https://pwa-preview.example.com/auth/callback/google');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    const link = await app.inject({ method: 'GET', url: '/auth/login/google?link=true', headers: { host: config.controlPlaneHost } });
    expect(link.statusCode).toBe(401);
    await app.close();
  });

  it('keeps /api/me inaccessible without a session even when Google is enabled', async () => {
    const app = buildApp({
      config: { ...config, googleClientId: 'google-client', googleClientSecret: 'google-secret' },
      pool: unusedPool,
    });
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { host: config.controlPlaneHost } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    await app.close();
  });

  it('requires authentication for removing linked providers', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const response = await app.inject({
      method: 'DELETE', url: '/api/me/identities/google',
      headers: { host: config.controlPlaneHost, origin: 'https://' + config.controlPlaneHost },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('requires an existing session to link GitHub', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const response = await app.inject({
      method: 'GET', url: '/auth/login/github?link=true',
      headers: { host: config.controlPlaneHost },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('does not expose or confirm account merges without authentication', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const headers = { host: config.controlPlaneHost, origin: 'https://' + config.controlPlaneHost };
    const preview = await app.inject({ method: 'GET', url: '/api/account-merge', headers });
    const confirm = await app.inject({ method: 'POST', url: '/api/account-merge/confirm', headers });
    const cancel = await app.inject({ method: 'POST', url: '/api/account-merge/cancel', headers });
    expect(preview.statusCode).toBe(401);
    expect(confirm.statusCode).toBe(401);
    expect(cancel.statusCode).toBe(401);
    await app.close();
  });

  it('requires authentication for /api/me', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { host: config.controlPlaneHost } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    await app.close();
  });
});

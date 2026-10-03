import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import type { DatabasePool } from '../../src/persistence/db.js';

const config: AppConfig = {
  controlPlaneHost: 'pwa-preview.example.com', previewDomainSuffix: 'preview.example.com', databaseUrl: 'postgres://unused', dataRoot: '/tmp/pwa-preview-auth-test',
  sessionSecret: '0123456789012345678901234567890123456789', githubClientId: 'client', githubClientSecret: 'secret',
  ttlMinMinutes: 5, ttlDefaultMinutes: 30, ttlMaxMinutes: 1440, maxCompressedBytes: 1, maxExtractedBytes: 2,
  maxFileCount: 3, maxPathLength: 1024, urlFetchTimeoutMs: 30000, maxRedirects: 5,
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

  it('requires authentication for /api/me', async () => {
    const app = buildApp({ config, pool: unusedPool });
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { host: config.controlPlaneHost } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    await app.close();
  });
});

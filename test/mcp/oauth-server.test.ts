import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerMcpOAuth } from '../../src/mcp/oauth-server.js';

const config = {
  controlPlaneHost: 'pwa-preview.example.com',
} as any;

describe('MCP OAuth authorization server', () => {
  it('publishes authorization server and protected resource metadata', async () => {
    const app = Fastify();
    await registerMcpOAuth(app, config, { query: async () => ({ rows: [], rowCount: 0 }) } as any);

    const auth = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(auth.statusCode).toBe(200);
    expect(auth.json()).toMatchObject({
      issuer: 'https://pwa-preview.example.com',
      authorization_endpoint: 'https://pwa-preview.example.com/authorize',
      token_endpoint: 'https://pwa-preview.example.com/token',
      registration_endpoint: 'https://pwa-preview.example.com/register',
      code_challenge_methods_supported: ['S256'],
    });

    const resource = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
    expect(resource.statusCode).toBe(200);
    expect(resource.json()).toMatchObject({
      resource: 'https://pwa-preview.example.com/mcp',
      authorization_servers: ['https://pwa-preview.example.com'],
      scopes_supported: ['mcp'],
    });
    await app.close();
  });

  it('supports dynamic registration for public PKCE clients', async () => {
    let insertValues: unknown[] | undefined;
    const db = {
      query: async (_sql: string, values?: unknown[]) => {
        insertValues = values;
        return { rows: [], rowCount: 1 };
      },
    } as any;
    const app = Fastify();
    await registerMcpOAuth(app, config, db);

    const response = await app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        client_name: 'ChatGPT',
        token_endpoint_auth_method: 'none',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(response.json().client_id).toMatch(/^pwc_/);
    expect(insertValues?.[1]).toContain('connector_platform_oauth_redirect');
    await app.close();
  });
  it('logs rejected refresh attempts without token contents', async () => {
    const logs: string[] = [];
    const app = Fastify({ logger: {
      level: 'info',
      stream: { write: (chunk: string) => { logs.push(chunk); } },
    } });
    await registerMcpOAuth(app, config, {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as any);
    const response = await app.inject({
      method: 'POST', url: '/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=refresh_token&client_id=test-client&refresh_token=do-not-log-this',
    });
    expect(response.statusCode).toBe(400);
    const events = logs.map(line => JSON.parse(line)).filter(event => event.event === 'oauth.refresh');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'rejected', reason: 'invalid_grant' });
    expect(logs.join('')).not.toContain('do-not-log-this');
    await app.close();
  });

  it('returns a stable successor during concurrent refresh retries and rejects the wrong client', async () => {
    const { createHash } = await import('node:crypto');
    const secret = 'pwr_test-original-secret';
    const digest = createHash('sha256').update(secret).digest('hex');
    let rotatedAt: number | null = null;
    const db = {
      query: async (sql: string, args: unknown[] = []) => {
        if (sql.includes('UPDATE oauth_refresh_tokens')) {
          if (args[0] !== digest || args[1] !== 'client-1' ||
              (args[2] != null && args[2] !== 'https://pwa-preview.example.com/mcp') ||
              (rotatedAt !== null && Date.now() - rotatedAt > 30_000)) {
            return { rows: [], rowCount: 0 };
          }
          rotatedAt ??= Date.now();
          return { rows: [{ token_hash: digest, client_id: 'client-1',
            user_id: '00000000-0000-4000-8000-000000000001', scope: 'mcp',
            resource: 'https://pwa-preview.example.com/mcp',
            expires_at: new Date(Date.now() + 60_000) }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    } as any;
    const app = Fastify();
    await registerMcpOAuth(app, { ...config, sessionSecret: 'secure-test-session-secret-of-sufficient-length' }, db);
    const refresh = (client_id = 'client-1') => app.inject({
      method: 'POST', url: '/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: secret, client_id,
      }).toString(),
    });
    const [a, b] = await Promise.all([refresh(), refresh()]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().refresh_token).toBe(b.json().refresh_token);
    expect((await refresh('different-client')).json().error).toBe('invalid_grant');
    rotatedAt = Date.now() - 31_000;
    expect((await refresh()).json().error).toBe('invalid_grant');
    await app.close();
  });

});

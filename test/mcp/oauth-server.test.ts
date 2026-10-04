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
});

import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import yazl from 'yazl';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createDatabasePool, runMigrations, type DatabasePool } from '../../src/persistence/db.js';
import { AllowlistRepository } from '../../src/persistence/repositories/allowlist-repository.js';
import { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { CleanupJob } from '../../src/preview/cleanup-job.js';
import { UrlArtifactSource } from '../../src/artifact/url-artifact-source.js';
import { UserService } from '../../src/users/user-service.js';
import { McpTokenService } from '../../src/mcp/token-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const e2e = databaseUrl ? describe.sequential : describe.skip;

function zipBuffer(version: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(`<!doctype html><html><body><main id="app">${version}</main><script src="/assets/app.js"></script></body></html>`), 'index.html');
    zip.addBuffer(Buffer.from(`window.APP_VERSION=${JSON.stringify(version)};`), 'assets/app.js');
    zip.addBuffer(Buffer.from(JSON.stringify({ name: 'E2E App', start_url: '/', display: 'standalone' })), 'manifest.webmanifest');
    zip.addBuffer(Buffer.from(`self.addEventListener('install',()=>self.skipWaiting()); // ${version}`), 'service-worker.js');
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

function multipart(boundary: string, file: Buffer, fields: Record<string, string> = {}): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="artifact"; filename="app.zip"\r\nContent-Type: application/zip\r\n\r\n`));
  chunks.push(file);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('missing set-cookie');
  return raw.split(';', 1)[0]!;
}

function rpcEnvelope(body: string): any {
  const line = body.split('\n').find((item) => item.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : body);
}

function toolOutput(envelope: any): any {
  return JSON.parse(envelope.result.content[0].text);
}

async function postRpc(address: string, token: string, payload: unknown): Promise<any> {
  const url = new URL(address);
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: url.hostname,
      port: Number(url.port),
      path: '/mcp',
      method: 'POST',
      headers: {
        host: 'control.example.test',
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`MCP HTTP ${res.statusCode}: ${text}`));
        resolve(rpcEnvelope(text));
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

e2e('full E2E', () => {
  let pool: DatabasePool;
  let tempRoot: string;
  let v1Path: string;
  let v2Path: string;
  let v1: Buffer;
  let v2: Buffer;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const githubIdentity = { subject: 'e2e-github-1', email: 'e2e@example.test', emailVerified: true as const, displayName: 'E2E User' };
  const githubClient = {
    exchangeCode: vi.fn(async () => 'e2e-access-token'),
    fetchIdentity: vi.fn(async () => githubIdentity),
  };

  beforeAll(async () => {
    pool = createDatabasePool(databaseUrl!);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool);
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-e2e-'));
    v1 = await zipBuffer('VERSION-1');
    v2 = await zipBuffer('VERSION-2');
    v1Path = path.join(tempRoot, 'v1.zip');
    v2Path = path.join(tempRoot, 'v2.zip');
    await writeFile(v1Path, v1);
    await writeFile(v2Path, v2);
    fetchSpy = vi.spyOn(UrlArtifactSource.prototype, 'fetch').mockImplementation(async function(sourceUrl: string) {
      const archivePath = sourceUrl.includes('v2') ? v2Path : v1Path;
      return { archivePath, cleanup: async () => undefined };
    });
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    await pool.end();
    await rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE mcp_tokens, previews, external_identities, allowlist_entries, users RESTART IDENTITY CASCADE');
    await rm(path.join(tempRoot, 'data'), { recursive: true, force: true });
  });

  function config(): AppConfig {
    return {
      controlPlaneHost: 'control.example.test',
      previewDomainSuffix: 'preview.example.test',
      databaseUrl: databaseUrl!,
      dataRoot: path.join(tempRoot, 'data'),
      sessionSecret: 'e2e-session-secret-that-is-at-least-32-characters',
      githubClientId: 'e2e-client',
      githubClientSecret: 'e2e-secret',
      ttlMinMinutes: 1,
      ttlDefaultMinutes: 5,
      ttlMaxMinutes: 60,
      maxCompressedBytes: 1024 * 1024,
      maxExtractedBytes: 4 * 1024 * 1024,
      maxFileCount: 100,
      maxPathLength: 512,
      urlFetchTimeoutMs: 1000,
      maxRedirects: 2,
      cleanupIntervalMs: 1000,
      reconciliationIntervalMs: 5000,
      staleOperationMinutes: 1,
      staleStagingMinutes: 1,
      migrateOnStart: false,
    };
  }

  async function authenticatedCookie(app: ReturnType<typeof buildApp>, email = githubIdentity.email): Promise<string> {
    await new AllowlistRepository(pool).add(email, 'github');
    const start = await app.inject({ method: 'GET', url: '/auth/login/github', headers: { host: 'control.example.test' } });
    expect(start.statusCode).toBe(302);
    const stateCookie = cookieFrom(start.headers['set-cookie']);
    const state = new URL(start.headers.location!).searchParams.get('state');
    expect(state).toBeTruthy();
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback/github?code=e2e-code&state=${encodeURIComponent(state!)}`,
      headers: { host: 'control.example.test', cookie: stateCookie },
    });
    expect(callback.statusCode).toBe(302);
    const authCookie = cookieFrom(callback.headers['set-cookie']);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { host: 'control.example.test', cookie: authCookie } });
    expect(me.statusCode).toBe(200);
    return authCookie;
  }

  test('browser/API: login -> create -> open PWA/SPA -> update same URL -> extend -> delete', async () => {
    const app = buildApp({ config: config(), pool, githubClient });
    const cookie = await authenticatedCookie(app);
    const boundary = '----pwa-preview-e2e-create';
    const create = await app.inject({
      method: 'POST', url: '/api/previews',
      headers: { host: 'control.example.test', cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, v1, { lifetimeMinutes: '5', name: 'Browser E2E' }),
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { previewId: string; url: string };
    const previewHost = new URL(created.url).hostname;

    const index = await app.inject({ method: 'GET', url: '/', headers: { host: previewHost } });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('VERSION-1');
    const spa = await app.inject({ method: 'GET', url: '/nested/route', headers: { host: previewHost } });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('VERSION-1');
    const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest', headers: { host: previewHost } });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().display).toBe('standalone');
    const js = await app.inject({ method: 'GET', url: '/assets/app.js', headers: { host: previewHost } });
    expect(js.body).toContain('VERSION-1');
    const sw = await app.inject({ method: 'GET', url: '/service-worker.js', headers: { host: previewHost } });
    expect(sw.body).toContain('VERSION-1');

    const updateBoundary = '----pwa-preview-e2e-update';
    const update = await app.inject({
      method: 'PUT', url: `/api/previews/${created.previewId}/content`,
      headers: { host: 'control.example.test', cookie, 'content-type': `multipart/form-data; boundary=${updateBoundary}` },
      payload: multipart(updateBoundary, v2),
    });
    expect(update.statusCode).toBe(200);
    expect((update.json() as { url: string }).url).toBe(created.url);
    const updated = await app.inject({ method: 'GET', url: '/', headers: { host: previewHost } });
    expect(updated.body).toContain('VERSION-2');

    const beforeExtend = new Date((update.json() as { expiresAt: string }).expiresAt).getTime();
    const extend = await app.inject({
      method: 'POST', url: `/api/previews/${created.previewId}/extend`,
      headers: { host: 'control.example.test', cookie, 'content-type': 'application/json' },
      payload: { lifetimeMinutes: 20 },
    });
    expect(extend.statusCode).toBe(200);
    expect(new Date((extend.json() as { expiresAt: string }).expiresAt).getTime()).toBeGreaterThan(beforeExtend);

    const del = await app.inject({ method: 'DELETE', url: `/api/previews/${created.previewId}`, headers: { host: 'control.example.test', cookie } });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: '/', headers: { host: previewHost } });
    expect(gone.statusCode).toBe(404);
    await app.close();
  });

  test('MCP: auth -> create(sourceUrl) -> list/get -> update -> extend -> delete', async () => {
    await new AllowlistRepository(pool).add(githubIdentity.email, 'github');
    const { userId } = await new UserService(pool).loginWithGithub(githubIdentity);
    const issued = await new McpTokenService(pool).issue(userId, 1);
    expect(await new McpTokenService(pool).authenticate(`Bearer ${issued.token}`)).toBe(userId);

    const app = buildApp({ config: config(), pool, githubClient });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    const createRpc = await postRpc(address, issued.token, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'preview_create', arguments: { sourceUrl: 'https://artifacts.example.test/v1.zip', lifetimeMinutes: 5, name: 'MCP E2E' } },
    });
    const created = toolOutput(createRpc) as { previewId: string; url: string };
    expect(created.previewId).toMatch(/^p-/);

    const listRpc = await postRpc(address, issued.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'preview_list', arguments: {} } });
    expect((toolOutput(listRpc) as { previews: Array<{ previewId: string }> }).previews.map((p) => p.previewId)).toContain(created.previewId);

    const getRpc = await postRpc(address, issued.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'preview_get', arguments: { previewId: created.previewId } } });
    expect((toolOutput(getRpc) as { url: string }).url).toBe(created.url);

    const updateRpc = await postRpc(address, issued.token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'preview_update', arguments: { previewId: created.previewId, sourceUrl: 'https://artifacts.example.test/v2.zip' } } });
    expect((toolOutput(updateRpc) as { url: string }).url).toBe(created.url);
    const previewHost = new URL(created.url).hostname;
    const updated = await app.inject({ method: 'GET', url: '/', headers: { host: previewHost } });
    expect(updated.body).toContain('VERSION-2');

    const extendRpc = await postRpc(address, issued.token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'preview_extend', arguments: { previewId: created.previewId, lifetimeMinutes: 20 } } });
    expect((toolOutput(extendRpc) as { previewId: string }).previewId).toBe(created.previewId);

    const deleteRpc = await postRpc(address, issued.token, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'preview_delete', arguments: { previewId: created.previewId } } });
    expect(toolOutput(deleteRpc)).toEqual({ previewId: created.previewId, deleted: true });
    expect((await app.inject({ method: 'GET', url: '/', headers: { host: previewHost } })).statusCode).toBe(404);
    await app.close();
  });

  test('restart: published preview survives restart, then expiry cleanup removes it', async () => {
    const app1 = buildApp({ config: config(), pool, githubClient });
    const cookie = await authenticatedCookie(app1);
    const boundary = '----pwa-preview-e2e-restart';
    const create = await app1.inject({
      method: 'POST', url: '/api/previews',
      headers: { host: 'control.example.test', cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, v1, { lifetimeMinutes: '5', name: 'Restart E2E' }),
    });
    const created = create.json() as { previewId: string; url: string };
    const previewHost = new URL(created.url).hostname;
    expect((await app1.inject({ method: 'GET', url: '/', headers: { host: previewHost } })).body).toContain('VERSION-1');
    await app1.close();

    const app2 = buildApp({ config: config(), pool, githubClient });
    const afterRestart = await app2.inject({ method: 'GET', url: '/', headers: { host: previewHost } });
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.body).toContain('VERSION-1');

    await pool.query('UPDATE previews SET expires_at = now() - interval \'1 second\' WHERE id = $1', [created.previewId]);
    const store = new LocalVolumeObjectStore(config().dataRoot);
    await store.initialize();
    expect(await new CleanupJob(new PreviewRepository(pool), store).runOnce()).toBe(1);
    const afterCleanup = await app2.inject({ method: 'GET', url: '/', headers: { host: previewHost } });
    expect(afterCleanup.statusCode).toBe(404);
    await app2.close();
  });
});

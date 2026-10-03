import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerMcp } from '../../src/mcp/server.js';

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive:true, force:true }); });

describe('MCP endpoint auth', () => {
  it('rejects requests without a valid bearer token', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'pwa-mcp-auth-')); dirs.push(dataRoot);
    const app = Fastify();
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as any;
    const config = {
      dataRoot,
      controlPlaneHost:'control.test',
      previewDomainSuffix:'preview.test',
      ttlMinMinutes:5, ttlDefaultMinutes:30, ttlMaxMinutes:1440,
      maxCompressedBytes:1024, maxExtractedBytes:2048, maxFileCount:100, maxPathLength:1024,
      urlFetchTimeoutMs:1000, urlMaxRedirects:2,
    } as any;
    await registerMcp(app, config, pool);
    const response = await app.inject({ method:'POST', url:'/mcp', headers:{ host:'control.test', 'content-type':'application/json' }, payload:{ jsonrpc:'2.0', id:1, method:'tools/list', params:{} } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error:'INVALID_MCP_TOKEN' });
    await app.close();
  });
});

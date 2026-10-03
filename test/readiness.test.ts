import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const dirs: string[] = [];
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive:true, force:true }); });

function config(dataRoot:string): AppConfig {
  return {
    controlPlaneHost:'control.example.com', previewDomainSuffix:'preview.example.com', databaseUrl:'postgres://unused', dataRoot,
    sessionSecret:'x'.repeat(32), githubClientId:'id', githubClientSecret:'secret', ttlMinMinutes:5, ttlDefaultMinutes:30, ttlMaxMinutes:1440,
    maxCompressedBytes:1, maxExtractedBytes:1, maxFileCount:1, maxPathLength:1024, urlFetchTimeoutMs:1000, maxRedirects:1,
      maxActivePreviewsPerUser: 20,
      maxConcurrentImportsPerUser: 2,
  maxStorageBytesPerUser:2147483648, maxStorageBytesTotal:21474836480,
    cleanupIntervalMs:1000, reconciliationIntervalMs:1000, staleOperationMinutes:30, staleStagingMinutes:60, migrateOnStart:true,
  };
}

describe('/ready', () => {
  it('returns 200 when database and data root are ready', async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-ready-')); dirs.push(dir);
    const pool:any={query:async()=>({rows:[{ok:1}]})};
    const app=buildApp({config:config(dir),pool});
    const response=await app.inject({method:'GET',url:'/ready',headers:{host:'control.example.com'}});
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('returns 503 when database check fails', async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-ready-')); dirs.push(dir);
    const pool:any={query:async()=>{throw new Error('db down')}};
    const app=buildApp({config:config(dir),pool});
    const response=await app.inject({method:'GET',url:'/ready',headers:{host:'control.example.com'}});
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});

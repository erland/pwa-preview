import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { runtimeCapabilities } from '../src/capabilities/runtime-capabilities.js';

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

function config(dataRoot: string): AppConfig {
  return {
    controlPlaneHost:'control.example.com',
    controlPlaneRegistrableDomain:'example.com',
    previewDomainSuffix:'preview.example.net',
    databaseUrl:'postgres://unused',
    dataRoot,
    sessionSecret:'x'.repeat(32),
    githubClientId:'id',
    githubClientSecret:'secret',
    ttlMinMinutes:7,
    ttlDefaultMinutes:45,
    ttlMaxMinutes:720,
    maxCompressedBytes:123456,
    maxExtractedBytes:500000,
    maxFileCount:100,
    maxPathLength:1024,
    urlFetchTimeoutMs:1000,
    maxRedirects:1,
    maxActivePreviewsPerUser:20,
    maxConcurrentImportsPerUser:2,
    maxStorageBytesPerUser:2147483648,
    maxStorageBytesTotal:21474836480,
    cleanupIntervalMs:1000,
    reconciliationIntervalMs:1000,
    staleOperationMinutes:30,
    staleStagingMinutes:60,
    migrateOnStart:true,
  };
}

describe('runtime capabilities', () => {
  it('exposes only client-relevant preview constraints', () => {
    const capabilities = runtimeCapabilities(config('/tmp/pwa-preview-capabilities'));
    expect(capabilities).toEqual({
      preview:{
        ttlMinutes:{ min:7, default:45, max:720 },
        name:{ maxLength:200 },
        sourceUrl:{ requiresHttps:true },
      },
      artifact:{ maxCompressedBytes:123456 },
    });
    expect(JSON.stringify(capabilities)).not.toContain('dataRoot');
    expect(JSON.stringify(capabilities)).not.toContain('sessionSecret');
    expect(JSON.stringify(capabilities)).not.toContain('databaseUrl');
  });

  it('serves capabilities without authentication on the control plane', async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-capabilities-')); dirs.push(dir);
    const pool:any={ query:async()=>({ rows:[] }) };
    const app=buildApp({ config:config(dir), pool });
    const response=await app.inject({ method:'GET', url:'/api/capabilities', headers:{ host:'control.example.com' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(runtimeCapabilities(config(dir)));
    await app.close();
  });

  it('does not expose the endpoint on an unrelated host', async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-capabilities-')); dirs.push(dir);
    const pool:any={ query:async()=>({ rows:[] }) };
    const app=buildApp({ config:config(dir), pool });
    const response=await app.inject({ method:'GET', url:'/api/capabilities', headers:{ host:'evil.example.org' } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

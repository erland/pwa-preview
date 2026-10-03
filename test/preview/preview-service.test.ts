import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { PreviewService } from '../../src/preview/preview-service.js';
import type { Preview } from '../../src/domain/models.js';
import type { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';
import type { AppConfig } from '../../src/config.js';

async function zip(file:string) {
  const z=new yazl.ZipFile(); z.addBuffer(Buffer.from('<h1>Hello</h1>'),'index.html'); z.addBuffer(Buffer.from('body{}'),'assets/app.css'); z.end();
  await new Promise<void>((resolve,reject)=>{ const out=createWriteStream(file); z.outputStream.pipe(out).on('close',resolve).on('error',reject); });
}

function config(root:string): AppConfig { return {
  controlPlaneHost:'pwa-preview.apps.isaksson.info', previewDomainSuffix:'previewapp.apphome.one', databaseUrl:'postgres://x', dataRoot:root,
  sessionSecret:'x'.repeat(32), githubClientId:'x', githubClientSecret:'x', ttlMinMinutes:5, ttlDefaultMinutes:30, ttlMaxMinutes:1440,
  maxCompressedBytes:100*1024*1024, maxExtractedBytes:500*1024*1024, maxFileCount:20000, maxPathLength:1024, urlFetchTimeoutMs:30000, maxRedirects:5,
}; }

class FakeRepo {
  item!: Preview;
  async create(input:any) { const now=new Date(); this.item={...input, displayName:input.displayName??null,status:'CREATING',createdAt:now,updatedAt:now,compressedSizeBytes:null,extractedSizeBytes:null,fileCount:null,sourceSha256:null,lastErrorCode:null}; return this.item; }
  async markReady(id:string, m:any) { this.item={...this.item,status:'READY',...m,updatedAt:new Date()}; return this.item; }
  async markFailed(_id:string, code:string) { this.item={...this.item,status:'FAILED',lastErrorCode:code}; }
}

describe('PreviewService', () => {
  it('publishes a valid upload and records READY metadata', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-service-')); const archive=path.join(root,'site.zip'); await zip(archive);
    const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize(); const repo=new FakeRepo();
    const service=new PreviewService(config(path.join(root,'data')), repo as unknown as PreviewRepository, store);
    const preview=await service.createFromFile({ownerUserId:'11111111-1111-1111-1111-111111111111',archivePath:archive,lifetimeMinutes:10});
    expect(preview.status).toBe('READY'); expect(preview.hostname).toBe(`${preview.id}.previewapp.apphome.one`); expect(preview.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path.join(root,'data','previews',preview.id,'current','index.html'),'utf8')).toContain('Hello');
    await rm(root,{recursive:true,force:true});
  });

  it('rejects TTL outside configured bounds before creating metadata', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-service-')); const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize(); const repo=new FakeRepo();
    const service=new PreviewService(config(path.join(root,'data')), repo as unknown as PreviewRepository, store);
    await expect(service.createFromFile({ownerUserId:'u',archivePath:'/missing',lifetimeMinutes:1})).rejects.toThrow('INVALID_TTL');
    expect(repo.item).toBeUndefined(); await rm(root,{recursive:true,force:true});
  });
});

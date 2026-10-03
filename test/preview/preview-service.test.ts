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
  controlPlaneHost:'pwa-preview.apps.isaksson.info', controlPlaneRegistrableDomain:'isaksson.info', previewDomainSuffix:'previewapp.apphome.one', databaseUrl:'postgres://x', dataRoot:root,
  sessionSecret:'x'.repeat(32), githubClientId:'x', githubClientSecret:'x', ttlMinMinutes:5, ttlDefaultMinutes:30, ttlMaxMinutes:1440,
  maxCompressedBytes:100*1024*1024, maxExtractedBytes:500*1024*1024, maxFileCount:20000, maxPathLength:1024, urlFetchTimeoutMs:30000, maxRedirects:5,
  maxActivePreviewsPerUser:20, maxConcurrentImportsPerUser:2,
  maxStorageBytesPerUser:2147483648, maxStorageBytesTotal:21474836480,
  cleanupIntervalMs:60000, reconciliationIntervalMs:600000, staleOperationMinutes:30, staleStagingMinutes:60, migrateOnStart:true,
}; }

class FakeRepo {
  item!: Preview;
  activeCount = 0;
  async countActiveOwned() { return this.activeCount; }
  async sumReadyExtractedBytesOwned() { return this.item?.status === 'READY' ? this.item.extractedSizeBytes ?? 0 : 0; }
  async sumReadyExtractedBytesTotal() { return this.item?.status === 'READY' ? this.item.extractedSizeBytes ?? 0 : 0; }
  async create(input:any) { const now=new Date(); this.item={...input, displayName:input.displayName??null,status:'CREATING',createdAt:now,updatedAt:now,compressedSizeBytes:null,extractedSizeBytes:null,fileCount:null,sourceSha256:null,lastErrorCode:null}; this.activeCount += 1; return this.item; }
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

  it('rejects creation when the owner has reached the active preview quota', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-service-'));
    const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize();
    const repo=new FakeRepo(); repo.activeCount=1;
    const limited={...config(path.join(root,'data')),maxActivePreviewsPerUser:1};
    const service=new PreviewService(limited, repo as unknown as PreviewRepository, store);
    await expect(service.createFromFile({ownerUserId:'owner-a',archivePath:'/missing'})).rejects.toThrow('ACTIVE_PREVIEW_LIMIT');
    await rm(root,{recursive:true,force:true});
  });

  it('rejects concurrent imports above the per-user limit', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-service-'));
    const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize();
    let releaseCreate!: () => void;
    let signalCreateStarted!: () => void;
    const createGate=new Promise<void>((resolve)=>{ releaseCreate=resolve; });
    const createStarted=new Promise<void>((resolve)=>{ signalCreateStarted=resolve; });
    const repo=new FakeRepo();
    const originalCreate=repo.create.bind(repo);
    repo.create=async (input:any) => { const created=await originalCreate(input); signalCreateStarted(); await createGate; return created; };
    const limited={...config(path.join(root,'data')),maxConcurrentImportsPerUser:1};
    const service=new PreviewService(limited, repo as unknown as PreviewRepository, store);
    const first=service.createFromFile({ownerUserId:'owner-a',archivePath:'/missing'});
    await createStarted;
    await expect(service.createFromFile({ownerUserId:'owner-a',archivePath:'/missing'})).rejects.toThrow('IMPORT_CONCURRENCY_LIMIT');
    releaseCreate();
    await expect(first).rejects.toThrow();
    await rm(root,{recursive:true,force:true});
  });


  it('rejects creation when the owner storage quota would be exceeded', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-service-'));
    const archive=path.join(root,'site.zip'); await zip(archive);
    const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize();
    const repo=new FakeRepo();
    const limited={...config(path.join(root,'data')),maxStorageBytesPerUser:1};
    const service=new PreviewService(limited, repo as unknown as PreviewRepository, store);
    await expect(service.createFromFile({ownerUserId:'owner-a',archivePath:archive})).rejects.toThrow('USER_STORAGE_QUOTA_LIMIT');
    expect(repo.item.status).toBe('FAILED');
    await rm(root,{recursive:true,force:true});
  });

  it('rejects creation when the total storage quota would be exceeded', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-service-'));
    const archive=path.join(root,'site.zip'); await zip(archive);
    const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize();
    const repo=new FakeRepo();
    const limited={...config(path.join(root,'data')),maxStorageBytesPerUser:1000000,maxStorageBytesTotal:1};
    const service=new PreviewService(limited, repo as unknown as PreviewRepository, store);
    await expect(service.createFromFile({ownerUserId:'owner-a',archivePath:archive})).rejects.toThrow('TOTAL_STORAGE_QUOTA_LIMIT');
    expect(repo.item.status).toBe('FAILED');
    await rm(root,{recursive:true,force:true});
  });

});

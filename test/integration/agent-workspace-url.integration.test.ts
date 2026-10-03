import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import type { Preview, PreviewSourceType, PreviewStatus } from '../../src/domain/models.js';
import type { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';
import { PreviewService } from '../../src/preview/preview-service.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { previewStorageKey } from '../../src/storage/storage-key.js';

const urlV1 = process.env.AGENT_WORKSPACE_ARTIFACT_URL_V1;
const urlV2 = process.env.AGENT_WORKSPACE_ARTIFACT_URL_V2;
const run = urlV1 && urlV2 ? it : it.skip;

class MemoryPreviewRepository {
  private readonly rows = new Map<string, Preview>();
  async create(input: { id:string; ownerUserId:string; hostname:string; expiresAt:Date; sourceType:PreviewSourceType; displayName?:string|null; status?:PreviewStatus }): Promise<Preview> {
    const now = new Date();
    const row: Preview = { id:input.id, ownerUserId:input.ownerUserId, displayName:input.displayName ?? null, status:input.status ?? 'CREATING', hostname:input.hostname, createdAt:now, updatedAt:now, expiresAt:input.expiresAt, compressedSizeBytes:null, extractedSizeBytes:null, fileCount:null, sourceSha256:null, sourceType:input.sourceType, lastErrorCode:null };
    this.rows.set(row.id,row); return row;
  }
  async findOwnedById(owner:string,id:string){ const r=this.rows.get(id); return r?.ownerUserId===owner?r:null; }
  async listOwned(owner:string){ return [...this.rows.values()].filter(r=>r.ownerUserId===owner&&r.status!=='DELETED'); }
  async markReady(id:string,m:{compressedSizeBytes:number;extractedSizeBytes:number;fileCount:number;sourceSha256:string}){ const r=this.rows.get(id)!; const n={...r,status:'READY' as const,updatedAt:new Date(),...m,lastErrorCode:null}; this.rows.set(id,n); return n; }
  async markFailed(id:string,code:string){ const r=this.rows.get(id); if(r)this.rows.set(id,{...r,status:'FAILED',updatedAt:new Date(),lastErrorCode:code}); }
  async markUpdatedOwned(owner:string,id:string,m:{compressedSizeBytes:number;extractedSizeBytes:number;fileCount:number;sourceSha256:string;sourceType:PreviewSourceType}){ const r=await this.findOwnedById(owner,id); if(!r||r.status!=='READY')return null; const n={...r,...m,updatedAt:new Date(),lastErrorCode:null}; this.rows.set(id,n); return n; }
  async markDeletingOwned(owner:string,id:string){ const r=await this.findOwnedById(owner,id); if(!r||r.status==='DELETED')return null; const n={...r,status:'DELETING' as const,updatedAt:new Date()}; this.rows.set(id,n); return n; }
  async markDeletedOwned(owner:string,id:string){ const r=await this.findOwnedById(owner,id); if(r)this.rows.set(id,{...r,status:'DELETED',updatedAt:new Date()}); }
  async extendOwned(){ return null; }
}

function config(dataRoot:string): AppConfig { return {
  controlPlaneHost:'control.example.com', previewDomainSuffix:'preview.example.com', databaseUrl:'postgres://unused', dataRoot,
  sessionSecret:'x'.repeat(32), githubClientId:'unused', githubClientSecret:'unused', ttlMinMinutes:5, ttlDefaultMinutes:30, ttlMaxMinutes:1440,
  maxCompressedBytes:100*1024*1024, maxExtractedBytes:500*1024*1024, maxFileCount:20000, maxPathLength:1024, urlFetchTimeoutMs:30000, maxRedirects:5,
  cleanupIntervalMs:60000, reconciliationIntervalMs:600000, staleOperationMinutes:30, staleStagingMinutes:60, migrateOnStart:false,
}; }

describe('Agent Workspace artifact URL integration', () => {
  run('creates, updates same preview id, and deletes using signed artifact URLs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),'pwa-preview-aw-'));
    try {
      const store = new LocalVolumeObjectStore(root); await store.initialize();
      const repo = new MemoryPreviewRepository();
      const service = new PreviewService(config(root), repo as unknown as PreviewRepository, store);
      const owner='user-aw';
      const created = await service.createFromUrl({ownerUserId:owner,sourceUrl:urlV1!,lifetimeMinutes:30,displayName:'Agent Workspace'});
      expect(created.status).toBe('READY');
      expect(created.sourceType).toBe('URL');
      const rootPath = store.getPreviewSiteRoot(previewStorageKey(created.id));
      expect(await readFile(path.join(rootPath,'index.html'),'utf8')).toContain('v1');
      expect(await readFile(path.join(rootPath,'manifest.webmanifest'),'utf8')).toContain('AW sample');

      const updated = await service.updateFromUrl({ownerUserId:owner,previewId:created.id,sourceUrl:urlV2!});
      expect(updated?.id).toBe(created.id);
      expect(await readFile(path.join(rootPath,'index.html'),'utf8')).toContain('v2');

      expect(await service.deleteOwned(owner,created.id)).toBe(true);
      await expect(readFile(path.join(rootPath,'index.html'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});

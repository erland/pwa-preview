import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { PreviewService } from '../../src/preview/preview-service.js';
import type { Preview } from '../../src/domain/models.js';
import { previewStorageKeyFromId } from '../../src/storage/storage-key.js';

function preview(overrides: Partial<Preview> = {}): Preview {
  const now = new Date();
  return {
    id: 'p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ownerUserId: 'owner-a', displayName: null, status: 'READY',
    hostname: 'p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.previewapp.apphome.one', createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60_000), compressedSizeBytes: 10, extractedSizeBytes: 20, fileCount: 1,
    sourceSha256: 'a'.repeat(64), sourceType: 'UPLOAD', lastErrorCode: null, ...overrides,
  };
}

const config:any = {
  maxCompressedBytes: 1000000, maxExtractedBytes: 2000000, maxFileCount: 100, maxPathLength: 1024,
  ttlDefaultMinutes: 30, ttlMinMinutes: 5, ttlMaxMinutes: 1440, previewDomainSuffix: 'previewapp.apphome.one',
  fetchTimeoutMs: 30000, maxRedirects: 5,
};

class RepoStub {
  value: Preview | null = preview();
  listOwned = async (owner:string) => this.value && this.value.ownerUserId === owner && this.value.status !== 'DELETED' ? [this.value] : [];
  findOwnedById = async (owner:string,id:string) => this.value && this.value.ownerUserId===owner && this.value.id===id ? this.value : null;
  extendOwned = async (owner:string,id:string,expiresAt:Date) => {
    const found=await this.findOwnedById(owner,id); if(!found) return null; this.value={...found,expiresAt,updatedAt:new Date()}; return this.value;
  };
  markDeletingOwned = async (owner:string,id:string) => {
    const found=await this.findOwnedById(owner,id); if(!found || found.status==='DELETED') return null; this.value={...found,status:'DELETING'}; return this.value;
  };
  markDeletedOwnedFromDeleting = async (owner:string,id:string) => { const found=await this.findOwnedById(owner,id); if(!found || found.status!=='DELETING') return false; this.value={...found,status:'DELETED'}; return true; };
  create = async () => { throw new Error('unused'); };
  markReadyFromCreating = async () => { throw new Error('unused'); };
  markFailedFromCreating = async () => false;
}

describe('PreviewService lifecycle', () => {
  it('lists and gets only the current owner previews', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-life-')); const store=new LocalVolumeObjectStore(root); await store.initialize();
    const repo=new RepoStub(); const service=new PreviewService(config, repo as any, store);
    expect((await service.listOwned('owner-a')).length).toBe(1);
    expect(await service.getOwned('owner-b', repo.value!.id)).toBeNull();
  });

  it('extends only forward and within configured TTL', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-life-')); const store=new LocalVolumeObjectStore(root); await store.initialize();
    const repo=new RepoStub(); repo.value=preview({expiresAt:new Date(Date.now()+6*60_000)}); const service=new PreviewService(config, repo as any, store);
    const result=await service.extendOwned('owner-a',repo.value.id,30); expect(result!.expiresAt.getTime()).toBeGreaterThan(Date.now()+20*60_000);
    await expect(service.extendOwned('owner-a',repo.value.id,1)).rejects.toThrow('INVALID_TTL');
  });

  it('deletes preview storage and is idempotent for the owner', async () => {
    const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-life-')); const store=new LocalVolumeObjectStore(root); await store.initialize();
    const repo=new RepoStub(); const key=previewStorageKeyFromId(repo.value!.id); await store.createPreviewArea(key); await writeFile(path.join(store.getPreviewSiteRoot(key),'index.html'),'ok');
    const service=new PreviewService(config, repo as any, store);
    expect(await service.deleteOwned('owner-b',repo.value!.id)).toBe(false);
    expect(await service.deleteOwned('owner-a',repo.value!.id)).toBe(true);
    expect(repo.value!.status).toBe('DELETED');
    expect(await service.deleteOwned('owner-a',repo.value!.id)).toBe(true);
  });
});

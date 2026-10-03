import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import type { AppConfig } from '../../src/config.js';
import type { Preview } from '../../src/domain/models.js';
import type { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';
import { PreviewService } from '../../src/preview/preview-service.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';

async function zip(file:string, html:string) {
  const z=new yazl.ZipFile(); z.addBuffer(Buffer.from(html),'index.html'); z.end();
  await new Promise<void>((resolve,reject)=>{ const out=createWriteStream(file); z.outputStream.pipe(out).on('close',resolve).on('error',reject); });
}
function config(root:string): AppConfig { return {
  controlPlaneHost:'pwa-preview.apps.isaksson.info', controlPlaneRegistrableDomain:'isaksson.info', previewDomainSuffix:'previewapp.apphome.one', databaseUrl:'postgres://x', dataRoot:root,
  sessionSecret:'x'.repeat(32), githubClientId:'x', githubClientSecret:'x', ttlMinMinutes:5, ttlDefaultMinutes:30, ttlMaxMinutes:1440,
  maxCompressedBytes:100*1024*1024, maxExtractedBytes:500*1024*1024, maxFileCount:20000, maxPathLength:1024, urlFetchTimeoutMs:30000, maxRedirects:5,
      maxActivePreviewsPerUser: 20,
      maxConcurrentImportsPerUser: 2,
  maxStorageBytesPerUser:2147483648, maxStorageBytesTotal:21474836480,
  cleanupIntervalMs:60000, reconciliationIntervalMs:600000, staleOperationMinutes:30, staleStagingMinutes:60, migrateOnStart:true,
}; }
function ready(ownerUserId='owner'): Preview { const now=new Date(); return { id:'p-0123456789abcdef0123456789abcdef', ownerUserId, displayName:null, status:'READY', hostname:'p-0123456789abcdef0123456789abcdef.previewapp.apphome.one', createdAt:now, updatedAt:now, expiresAt:new Date(now.getTime()+600000), compressedSizeBytes:1, extractedSizeBytes:1, fileCount:1, sourceSha256:'0'.repeat(64), sourceType:'UPLOAD', lastErrorCode:null }; }
class UpdateRepo {
  item: Preview;
  failMetadata=false;
  constructor(item=ready()){ this.item=item; }
  async findOwnedById(owner:string,id:string){ return this.item.ownerUserId===owner && this.item.id===id ? this.item : null; }
  async sumReadyExtractedBytesOwned(){ return this.item.status==='READY' ? this.item.extractedSizeBytes ?? 0 : 0; }
  async sumReadyExtractedBytesTotal(){ return this.item.status==='READY' ? this.item.extractedSizeBytes ?? 0 : 0; }
  async markUpdatedOwned(owner:string,id:string,m:any){
    if(this.failMetadata) throw new Error('DB_DOWN');
    if(this.item.ownerUserId!==owner || this.item.id!==id || this.item.status!=='READY') return null;
    this.item={...this.item,...m,updatedAt:new Date()}; return this.item;
  }
}
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-update-'));
  const data=path.join(root,'data'); const store=new LocalVolumeObjectStore(data); await store.initialize();
  const item=ready(); const current=path.join(data,'previews',item.id,'current'); await mkdir(current,{recursive:true}); await writeFile(path.join(current,'index.html'),'OLD');
  const repo=new UpdateRepo(item); const service=new PreviewService(config(data),repo as unknown as PreviewRepository,store);
  return {root,data,store,repo,service,item};
}
describe('PreviewService atomic update',()=>{
  it('replaces content on same preview id after successful validation',async()=>{ const f=await fixture(); const a=path.join(f.root,'new.zip'); await zip(a,'NEW'); const updated=await f.service.updateFromFile({ownerUserId:'owner',previewId:f.item.id,archivePath:a}); expect(updated?.id).toBe(f.item.id); expect(await readFile(path.join(f.data,'previews',f.item.id,'current','index.html'),'utf8')).toBe('NEW'); expect(updated?.sourceSha256).not.toBe('0'.repeat(64)); await rm(f.root,{recursive:true,force:true}); });
  it('leaves old content active when the new artifact is invalid',async()=>{ const f=await fixture(); const bad=path.join(f.root,'bad.zip'); await writeFile(bad,'not an archive'); await expect(f.service.updateFromFile({ownerUserId:'owner',previewId:f.item.id,archivePath:bad})).rejects.toThrow(); expect(await readFile(path.join(f.data,'previews',f.item.id,'current','index.html'),'utf8')).toBe('OLD'); await rm(f.root,{recursive:true,force:true}); });
  it('rolls back filesystem swap when metadata update fails',async()=>{ const f=await fixture(); f.repo.failMetadata=true; const a=path.join(f.root,'new.zip'); await zip(a,'NEW'); await expect(f.service.updateFromFile({ownerUserId:'owner',previewId:f.item.id,archivePath:a})).rejects.toThrow('DB_DOWN'); expect(await readFile(path.join(f.data,'previews',f.item.id,'current','index.html'),'utf8')).toBe('OLD'); await rm(f.root,{recursive:true,force:true}); });
  it('does not update a preview owned by another user',async()=>{ const f=await fixture(); const a=path.join(f.root,'new.zip'); await zip(a,'NEW'); expect(await f.service.updateFromFile({ownerUserId:'other',previewId:f.item.id,archivePath:a})).toBeNull(); expect(await readFile(path.join(f.data,'previews',f.item.id,'current','index.html'),'utf8')).toBe('OLD'); await rm(f.root,{recursive:true,force:true}); });
});

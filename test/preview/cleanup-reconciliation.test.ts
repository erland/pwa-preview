import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { previewStorageKeyFromId } from '../../src/storage/storage-key.js';
import { CleanupJob } from '../../src/preview/cleanup-job.js';
import { ReconciliationJob } from '../../src/preview/reconciliation-job.js';

const roots:string[]=[];
afterEach(async()=>{ for (const r of roots.splice(0)) await rm(r,{recursive:true,force:true}); });

function preview(id:string,status='READY',updatedAt=new Date(0)){ return { id,status,updatedAt }; }

describe('cleanup/reconciliation',()=>{
  it('deletes claimed expired preview storage and marks it deleted', async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'cleanup-')); roots.push(root); const store=new LocalVolumeObjectStore(root); await store.initialize();
    const id='p-'+ 'a'.repeat(32); const key=previewStorageKeyFromId(id); await store.createPreviewArea(key); await writeFile(path.join(store.getPreviewSiteRoot(key),'index.html'),'x');
    const deleted:string[]=[]; const repo:any={ claimExpired: async()=>[preview(id,'EXPIRED')], markDeletedSystem: async(id:string)=>deleted.push(id) };
    expect(await new CleanupJob(repo,store).runOnce()).toBe(1); expect(deleted).toEqual([id]);
    await expect(readFile(path.join(store.getPreviewSiteRoot(key),'index.html'))).rejects.toBeTruthy();
  });

  it('completes DELETING, fails stale CREATING, removes orphan preview storage and stale staging', async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'reconcile-')); roots.push(root); const store=new LocalVolumeObjectStore(root); await store.initialize();
    const deleting='p-'+ 'b'.repeat(32), creating='p-'+ 'c'.repeat(32), orphan='p-'+ 'd'.repeat(32);
    for (const id of [deleting,creating,orphan]) { const k=previewStorageKeyFromId(id); await store.createPreviewArea(k); await writeFile(path.join(store.getPreviewSiteRoot(k),'index.html'),'x'); }
    const staging=await store.createStagingArea(); const old=new Date(Date.now()-2*60*60*1000); await utimes(path.dirname(store.getStagingSiteRoot(staging)),old,old);
    const calls:{deleted:string[]; failed:string[]}={deleted:[],failed:[]};
    const repo:any={
      listByStatus: async()=>[preview(deleting,'DELETING')], listStaleCreating: async()=>[preview(creating,'CREATING')],
      listActiveIds: async()=>[deleting,creating], markDeletedSystem: async(id:string)=>calls.deleted.push(id), markFailed: async(id:string)=>calls.failed.push(id),
    };
    const result=await new ReconciliationJob(repo,store).runOnce({staleCreatingBefore:new Date(),staleStagingBefore:new Date(Date.now()-60*60*1000)});
    expect(result).toEqual({completedDeleting:1,failedCreating:1,deletedOrphanPreviews:1,deletedStaging:1});
    expect(calls.deleted).toEqual([deleting]); expect(calls.failed).toEqual([creating]);
  });

  it('leaves active preview storage alone', async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'reconcile-active-')); roots.push(root); const store=new LocalVolumeObjectStore(root); await store.initialize();
    const id='p-'+ 'e'.repeat(32); const key=previewStorageKeyFromId(id); await store.createPreviewArea(key); await writeFile(path.join(store.getPreviewSiteRoot(key),'index.html'),'alive');
    const repo:any={ listByStatus:async()=>[], listStaleCreating:async()=>[], listActiveIds:async()=>[id] };
    await new ReconciliationJob(repo,store).runOnce({staleCreatingBefore:new Date(),staleStagingBefore:new Date(0)});
    expect(await readFile(path.join(store.getPreviewSiteRoot(key),'index.html'),'utf8')).toBe('alive');
  });
});

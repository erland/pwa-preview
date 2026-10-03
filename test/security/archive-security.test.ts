import { createWriteStream } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar-stream';
import type { Header } from 'tar-stream';
import yazl from 'yazl';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchiveImporter } from '../../src/artifact/archive-importer.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';

const roots:string[]=[];
afterEach(async()=>{ await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true}))); });
async function fixture(limits: {maxCompressedBytes:number;maxExtractedBytes:number;maxFileCount:number;maxPathLength:number}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'pwa-sec-')); roots.push(root);
  const store=new LocalVolumeObjectStore(path.join(root,'data')); await store.initialize();
  return {root, importer:new ArchiveImporter(store,limits)};
}
async function zip(file:string, content:string){ const z=new yazl.ZipFile(); z.addBuffer(Buffer.from('<h1>x</h1>'),'index.html'); z.addBuffer(Buffer.from(content),'big.txt'); z.end(); await new Promise<void>((resolve,reject)=>z.outputStream.pipe(createWriteStream(file)).on('close',resolve).on('error',reject)); }
async function tarGz(file:string, type:Header['type']){ const p=tar.pack(); const chunks:Buffer[]=[]; p.on('data',(c:Buffer)=>chunks.push(Buffer.from(c))); const done=new Promise<void>((resolve,reject)=>p.on('end',resolve).on('error',reject)); await new Promise<void>((resolve,reject)=>p.entry({name:'index.html',type:'file'},'ok',e=>e?reject(e):resolve())); await new Promise<void>((resolve,reject)=>p.entry({name:'danger',type,linkname:'index.html'},'',e=>e?reject(e):resolve())); p.finalize(); await done; await writeFile(file,gzipSync(Buffer.concat(chunks))); }

describe('release security: archive limits and special entries',()=>{
  const base={maxCompressedBytes:1024*1024,maxExtractedBytes:1024*1024,maxFileCount:100,maxPathLength:1024};
  it.each(['link','fifo','character-device'] as const)('rejects tar special entry %s',async(type)=>{ const f=await fixture(base); const a=path.join(f.root,'bad.tar.gz'); await tarGz(a,type); await expect(f.importer.importFromFile(a)).rejects.toThrow(/Links and special files/); });
  it('rejects compressed artifact above configured limit',async()=>{ const f=await fixture({...base,maxCompressedBytes:40}); const a=path.join(f.root,'large.zip'); await zip(a,'x'.repeat(500)); await expect(f.importer.importFromFile(a)).rejects.toThrow(/Compressed artifact size exceeds limit/); });
  it('rejects extracted data above configured limit',async()=>{ const f=await fixture({...base,maxExtractedBytes:32}); const a=path.join(f.root,'large.zip'); await zip(a,'x'.repeat(200)); await expect(f.importer.importFromFile(a)).rejects.toThrow(/extracted size exceeds limit/); });
});

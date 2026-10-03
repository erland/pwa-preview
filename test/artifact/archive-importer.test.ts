import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as tar from 'tar-stream';
import type { Header } from 'tar-stream';
import yazl from 'yazl';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchiveImporter } from '../../src/artifact/archive-importer.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';

const roots: string[] = [];
const limits = { maxCompressedBytes: 1024 * 1024, maxExtractedBytes: 1024 * 1024, maxFileCount: 100, maxPathLength: 256 };
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r,{recursive:true,force:true}))); });
async function root() { const r=await mkdtemp(path.join(os.tmpdir(),'pwa-preview-artifact-')); roots.push(r); return r; }

async function zipFile(file: string, entries: Array<{name:string, content:string, mode?:number}>) {
  const zip = new yazl.ZipFile();
  for (const e of entries) zip.addBuffer(Buffer.from(e.content), e.name, e.mode ? { mode: e.mode } : undefined);
  zip.end(); await new Promise<void>((resolve,reject)=>{ zip.outputStream.pipe(createWriteStream(file)).on('close',resolve).on('error',reject); });
}
async function tarGzFile(file: string, entries: Array<{name:string, content?:string, type?:Header['type'], linkname?:string}>) {
  const pack = tar.pack(); const chunks: Buffer[]=[];
  pack.on('data',(c: unknown)=>{ chunks.push(Buffer.from(c as Uint8Array)); });
  const done=new Promise<void>((resolve,reject)=>pack.on('end',resolve).on('error',reject));
  for (const e of entries) await new Promise<void>((resolve,reject)=>pack.entry({name:e.name,type:e.type ?? 'file',...(e.linkname ? {linkname:e.linkname} : {})},e.content ?? '',(err)=>err?reject(err):resolve()));
  pack.finalize(); await done; await writeFile(file,gzipSync(Buffer.concat(chunks)));
}

async function importer(r:string) { const store=new LocalVolumeObjectStore(path.join(r,'data')); await store.initialize(); return new ArchiveImporter(store,limits); }

describe('ArchiveImporter', () => {
  it('imports ZIP with files at root', async () => { const r=await root(); const f=path.join(r,'a.zip'); await zipFile(f,[{name:'index.html',content:'zip ok'},{name:'assets/app.js',content:'x'}]); const out=await (await importer(r)).importFromFile(f); expect(await readFile(path.join(out.artifact.siteRoot,'index.html'),'utf8')).toBe('zip ok'); expect(out.artifact.fileCount).toBe(2); });
  it('imports tar.gz with one top directory and normalizes site root', async () => { const r=await root(); const f=path.join(r,'a.tar.gz'); await tarGzFile(f,[{name:'dist/index.html',content:'tar ok'},{name:'dist/app.js',content:'x'}]); const out=await (await importer(r)).importFromFile(f); expect(await readFile(path.join(out.artifact.siteRoot,'index.html'),'utf8')).toBe('tar ok'); });
  it('rejects ZIP traversal', async () => {
    const r=await root(); const f=path.join(r,'bad.zip');
    await zipFile(f,[{name:'xx/evil.txt',content:'bad'}]);
    const raw = await readFile(f);
    const from = Buffer.from('xx/evil.txt'); const to = Buffer.from('../evil.txt');
    let offset = 0; let replacements = 0;
    while ((offset = raw.indexOf(from, offset)) !== -1) { to.copy(raw, offset); offset += to.length; replacements += 1; }
    expect(replacements).toBeGreaterThanOrEqual(2);
    await writeFile(f, raw);
    await expect((await importer(r)).importFromFile(f)).rejects.toThrow(/traversal|invalid relative path/);
  });
  it('rejects tar symlinks', async () => { const r=await root(); const f=path.join(r,'bad.tar.gz'); await tarGzFile(f,[{name:'index.html',content:'ok'},{name:'link',type:'symlink',linkname:'/etc/passwd'}]); await expect((await importer(r)).importFromFile(f)).rejects.toThrow(/Links and special files/); });
  it('rejects missing index.html', async () => { const r=await root(); const f=path.join(r,'bad.zip'); await zipFile(f,[{name:'app.js',content:'x'}]); await expect((await importer(r)).importFromFile(f)).rejects.toThrow(/index.html/); });
  it('enforces file count', async () => { const r=await root(); const f=path.join(r,'many.zip'); await zipFile(f,[{name:'index.html',content:'x'},{name:'a',content:'1'},{name:'b',content:'2'}]); const store=new LocalVolumeObjectStore(path.join(r,'data')); await store.initialize(); const imp=new ArchiveImporter(store,{...limits,maxFileCount:2}); await expect(imp.importFromFile(f)).rejects.toThrow(/too many files/); });
  it('rejects unsupported format', async () => { const r=await root(); const f=path.join(r,'x.bin'); await writeFile(f,'not archive'); await expect((await importer(r)).importFromFile(f)).rejects.toThrow(/Unsupported archive/); });
});

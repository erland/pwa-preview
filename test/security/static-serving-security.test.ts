import Fastify from 'fastify';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { servePreview } from '../../src/preview/static-site-handler.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { previewStorageKey } from '../../src/storage/storage-key.js';

const roots:string[]=[];
afterEach(async()=>Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true}))));

async function setup(){
  const root=await mkdtemp(path.join(os.tmpdir(),'pwa-static-sec-'));
  roots.push(root);
  const store=new LocalVolumeObjectStore(path.join(root,'data'));
  await store.initialize();
  const id='p-0123456789abcdef0123456789abcdef';
  const site=store.getPreviewSiteRoot(previewStorageKey(id));
  await mkdir(site,{recursive:true});
  await writeFile(path.join(site,'index.html'),'SAFE');
  await writeFile(path.join(root,'secret.txt'),'SECRET');
  const repo={findReadyById:async()=>({id,expiresAt:new Date(Date.now()+60000)})};
  const app=Fastify();
  app.all('*',async(req,reply)=>servePreview(req,reply,id,repo as any,store));
  return {app,site};
}

describe('release security: static serving',()=>{
  it.each(['/../secret.txt','/%2e%2e/secret.txt','/%2e%2e%2fsecret.txt','/%00bad'])('does not escape preview root for %s',async url=>{
    const {app}=await setup();
    const res=await app.inject({method:'GET',url});
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('sets anti-indexing and nosniff headers on preview content',async()=>{
    const {app}=await setup();
    const res=await app.inject({method:'GET',url:'/'});
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });

  it('serves larger preview files with an explicit content length',async()=>{
    const {app,site}=await setup();
    const payload=Buffer.alloc(2*1024*1024,0x5a);
    await writeFile(path.join(site,'large.bin'),payload);
    const res=await app.inject({method:'GET',url:'/large.bin'});
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(payload.length));
    expect(res.rawPayload.equals(payload)).toBe(true);
    await app.close();
  });

  it('answers HEAD without reading a response body',async()=>{
    const {app,site}=await setup();
    const payload=Buffer.alloc(2*1024*1024,0x41);
    await writeFile(path.join(site,'large.bin'),payload);
    const res=await app.inject({method:'HEAD',url:'/large.bin'});
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(payload.length));
    expect(res.rawPayload.length).toBe(0);
    await app.close();
  });
});

import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';

const config:AppConfig={controlPlaneHost:'control.example.com',previewDomainSuffix:'preview.example.com',databaseUrl:'postgres://x',dataRoot:'/tmp/pwa-preview-auth-security',sessionSecret:'s'.repeat(32),githubClientId:'client',githubClientSecret:'secret',ttlMinMinutes:5,ttlDefaultMinutes:30,ttlMaxMinutes:1440,maxCompressedBytes:100000,maxExtractedBytes:500000,maxFileCount:100,maxPathLength:1024,urlFetchTimeoutMs:30000,maxRedirects:5,
  maxActivePreviewsPerUser:20, maxConcurrentImportsPerUser:2,cleanupIntervalMs:60000,reconciliationIntervalMs:600000,staleOperationMinutes:30,staleStagingMinutes:60,migrateOnStart:false};
const github={exchangeCode:async()=> 'token',fetchIdentity:async()=>({subject:'123',email:'blocked@example.com',emailVerified:true,displayName:'Blocked'})};
const deniedPool:any={query:async(sql:string)=>{ if(sql.includes('allowlist_entries')) return {rows:[{allowed:false}]}; throw new Error('unexpected query: '+sql); },connect:async()=>{throw new Error('should not connect');},end:async()=>{}};

describe('release security: auth and cookie isolation',()=>{
  it('uses a host-only secure session cookie with no Domain attribute',async()=>{ const app=buildApp({config,pool:deniedPool,githubClient:github as any}); const res=await app.inject({method:'GET',url:'/auth/login/github',headers:{host:config.controlPlaneHost}}); const cookie=String(res.headers['set-cookie']); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toMatch(/SameSite=Lax/i); expect(cookie).not.toMatch(/Domain=/i); await app.close(); });
  it('denies a verified GitHub identity that is not allowlisted',async()=>{ const app=buildApp({config,pool:deniedPool,githubClient:github as any}); const login=await app.inject({method:'GET',url:'/auth/login/github',headers:{host:config.controlPlaneHost}}); const location=new URL(String(login.headers.location)); const state=location.searchParams.get('state')!; const cookie=String(login.headers['set-cookie']).split(';',1)[0]!; const cb=await app.inject({method:'GET',url:`/auth/callback/github?code=x&state=${encodeURIComponent(state)}`,headers:{host:config.controlPlaneHost,cookie}}); expect(cb.statusCode).toBe(403); expect(cb.json()).toEqual({error:'IDENTITY_NOT_ALLOWLISTED'}); await app.close(); });
});

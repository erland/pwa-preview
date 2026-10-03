import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';

const config:AppConfig={controlPlaneHost:'control.example.com', controlPlaneRegistrableDomain:'example.com', controlPlaneRegistrableDomain:'example.com',previewDomainSuffix:'preview.example.net',databaseUrl:'postgres://x',dataRoot:'/tmp/pwa-preview-auth-security',sessionSecret:'s'.repeat(32),githubClientId:'client',githubClientSecret:'secret',ttlMinMinutes:5,ttlDefaultMinutes:30,ttlMaxMinutes:1440,maxCompressedBytes:100000,maxExtractedBytes:500000,maxFileCount:100,maxPathLength:1024,urlFetchTimeoutMs:30000,maxRedirects:5,
  maxActivePreviewsPerUser:20, maxConcurrentImportsPerUser:2,
  maxStorageBytesPerUser:2147483648, maxStorageBytesTotal:21474836480,cleanupIntervalMs:60000,reconciliationIntervalMs:600000,staleOperationMinutes:30,staleStagingMinutes:60,migrateOnStart:false};
const github={exchangeCode:async()=> 'token',fetchIdentity:async()=>({subject:'123',email:'blocked@example.com',emailVerified:true,displayName:'Blocked'})};
const deniedPool:any={query:async(sql:string)=>{ if(sql.includes('allowlist_entries')) return {rows:[{allowed:false}]}; throw new Error('unexpected query: '+sql); },connect:async()=>{throw new Error('should not connect');},end:async()=>{}};

describe('release security: auth and cookie isolation',()=>{
  it('uses a host-only secure session cookie with no Domain attribute',async()=>{ const app=buildApp({config,pool:deniedPool,githubClient:github as any}); const res=await app.inject({method:'GET',url:'/auth/login/github',headers:{host:config.controlPlaneHost}}); const cookie=String(res.headers['set-cookie']); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toMatch(/SameSite=Lax/i); expect(cookie).not.toMatch(/Domain=/i); await app.close(); });
  it('denies a verified GitHub identity that is not allowlisted',async()=>{ const app=buildApp({config,pool:deniedPool,githubClient:github as any}); const login=await app.inject({method:'GET',url:'/auth/login/github',headers:{host:config.controlPlaneHost}}); const location=new URL(String(login.headers.location)); const state=location.searchParams.get('state')!; const cookie=String(login.headers['set-cookie']).split(';',1)[0]!; const cb=await app.inject({method:'GET',url:`/auth/callback/github?code=x&state=${encodeURIComponent(state)}`,headers:{host:config.controlPlaneHost,cookie}}); expect(cb.statusCode).toBe(403); expect(cb.json()).toEqual({error:'IDENTITY_NOT_ALLOWLISTED'}); await app.close(); });

  it('revokes an existing browser session after allowlist access is removed',async()=>{
    let allowed=true;
    const identityRow={
      id:'identity-1',user_id:'user-1',provider:'github',provider_subject:'123',
      email:'allowed@example.com',email_verified:true,display_name:'Allowed',
      created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    };
    const pool:any={
      query:async(sql:string)=>{
        if(sql.includes('allowlist_entries')) return {rows:[{allowed}]};
        if(sql.includes('external_identities WHERE provider = $1 AND provider_subject = $2')) return {rows:[identityRow]};
        if(sql.includes('external_identities WHERE user_id = $1 AND provider = $2')) return {rows:[identityRow]};
        if(sql.startsWith('UPDATE external_identities')) return {rows:[]};
        if(sql.startsWith('UPDATE users SET last_login_at')) return {rows:[]};
        throw new Error('unexpected query: '+sql);
      },
      connect:async()=>{throw new Error('should not connect');},
      end:async()=>{},
    };
    const allowedGithub={
      exchangeCode:async()=> 'token',
      fetchIdentity:async()=>({subject:'123',email:'allowed@example.com',emailVerified:true,displayName:'Allowed'}),
    };
    const app=buildApp({config,pool,githubClient:allowedGithub as any});
    const login=await app.inject({method:'GET',url:'/auth/login/github',headers:{host:config.controlPlaneHost}});
    const state=new URL(String(login.headers.location)).searchParams.get('state')!;
    const stateCookie=String(login.headers['set-cookie']).split(';',1)[0]!;
    const cb=await app.inject({method:'GET',url:`/auth/callback/github?code=x&state=${encodeURIComponent(state)}`,headers:{host:config.controlPlaneHost,cookie:stateCookie}});
    expect(cb.statusCode).toBe(302);
    const sessionCookie=String(cb.headers['set-cookie']).split(';',1)[0]!;
    allowed=false;
    const me=await app.inject({method:'GET',url:'/api/me',headers:{host:config.controlPlaneHost,cookie:sessionCookie}});
    expect(me.statusCode).toBe(401);
    expect(me.json()).toEqual({error:'AUTHENTICATION_REQUIRED'});
    expect(String(me.headers['set-cookie'])).toContain('pwa_preview_session=');
    await app.close();
  });

});

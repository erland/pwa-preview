import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Preview = {
  previewId: string;
  url: string;
  name: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  publicationMode: 'TEMPORARY' | 'PERMANENT';
  slug: string | null;
  compressedSizeBytes: number | null;
  extractedSizeBytes: number | null;
  fileCount: number | null;
  sourceSha256: string | null;
  sourceType: string;
};

type MergePreview = { provider: 'github' | 'google'; currentPreviews: number; otherPreviews: number; currentPermanent: number; otherPermanent: number };

type Me = { userId: string; identities: { provider: string; email: string | null }[] };

type RuntimeCapabilities = {
  preview: {
    ttlMinutes: { min: number; default: number; max: number };
    name: { maxLength: number };
    sourceUrl: { requiresHttps: true };
  };
  artifact: { maxCompressedBytes: number };
};

const visualTest = new URLSearchParams(window.location.search).has('__visual_test');
const visualMocks: Preview[] = [
  {previewId:'p-qa-demo-import',name:'Importdeklaration',url:'https://import.preview.example',status:'READY',createdAt:'2026-10-10T03:00:00Z',updatedAt:'2026-10-10T03:00:00Z',expiresAt:null,publicationMode:'PERMANENT',slug:'import',compressedSizeBytes:12000,extractedSizeBytes:56000,fileCount:12,sourceSha256:null,sourceType:'UPLOAD'},
  {previewId:'p-qa-demo-case',name:'Utredningssystem',url:'https://cases.preview.example',status:'READY',createdAt:'2026-10-09T03:00:00Z',updatedAt:'2026-10-09T03:00:00Z',expiresAt:'2026-10-11T03:00:00Z',publicationMode:'TEMPORARY',slug:null,compressedSizeBytes:7000,extractedSizeBytes:12000,fileCount:8,sourceSha256:null,sourceType:'UPLOAD'},
  {previewId:'p-qa-demo-report',name:'Statistikdashboard',url:'https://stats.preview.example',status:'READY',createdAt:'2026-10-08T03:00:00Z',updatedAt:'2026-10-08T03:00:00Z',expiresAt:'2026-10-12T03:00:00Z',publicationMode:'TEMPORARY',slug:null,compressedSizeBytes:4000,extractedSizeBytes:8000,fileCount:6,sourceSha256:null,sourceType:'URL'}
];
async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  if (visualTest) {
    if (input === '/api/auth/providers') return {google:true} as T;
    if (input === '/api/capabilities') return {preview:{ttlMinutes:{min:5,default:60,max:1440},name:{maxLength:200},sourceUrl:{requiresHttps:true}},artifact:{maxCompressedBytes:100000000}} as T;
    if (input === '/api/me') return {userId:'qa-user',identities:[{provider:'google',email:'demo@example.test'},{provider:'github',email:'demo@example.test'}]} as T;
    if (input === '/api/previews') return {previews:visualMocks} as T;
    return undefined as T;
  }
  const response = await fetch(input, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP_${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (value == null) return '–';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [merge, setMerge] = useState<MergePreview | null>(null);
  const [page, setPage] = useState<'previews' | 'settings'>(() => window.location.pathname === '/settings' || new URLSearchParams(window.location.search).get('view')==='settings' ? 'settings' : 'previews');
  const [showCreate, setShowCreate] = useState(() => new URLSearchParams(window.location.search).has('create'));
  const [filter, setFilter] = useState<'all' | 'temporary' | 'permanent'>('all');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null | undefined>(undefined);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mcpToken, setMcpToken] = useState<{ token: string; expiresAt: string } | null>(null);

  const sorted = useMemo(() => [...previews].filter(p => filter === 'all' || p.publicationMode === (filter === 'temporary' ? 'TEMPORARY' : 'PERMANENT')).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [previews, filter]);
  const activeCount = previews.filter(p => !['DELETED','EXPIRED'].includes(p.status)).length;
  const permanentCount = previews.filter(p => p.publicationMode === 'PERMANENT').length;
  function navigate(next: 'previews' | 'settings') { setPage(next); window.history.pushState({}, '', next === 'settings' ? '/settings' : '/'); setMenuId(null); }
  useEffect(() => { const onPop = () => setPage(window.location.pathname === '/settings' ? 'settings' : 'previews'); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);

  async function refresh() {
    try {
      const data = await api<{ previews: Preview[] }>('/api/previews');
      setPreviews(data.previews);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte läsa previews');
    }
  }

  useEffect(() => {
    Promise.all([
      api<{ google: boolean }>('/api/auth/providers').then(p => setGoogleEnabled(p.google)),
      api<RuntimeCapabilities>('/api/capabilities'),
      api<Me>('/api/me').then((value) => ({ authenticated: true as const, value })).catch(() => ({ authenticated: false as const })),
    ]).then(([, runtime, identity]) => {
      setCapabilities(runtime);
      setTtl(String(runtime.preview.ttlMinutes.default));
      if (!identity.authenticated) {
        setMe(null);
        return;
      }
      setMe(identity.value);
      if (new URLSearchParams(window.location.search).get('merge') === 'review') {
        api<MergePreview>('/api/account-merge').then(setMerge).catch(() => setError('Sammanslagningsförslaget är inte längre giltigt. Försök koppla kontot igen.'));
      }
      return refresh();
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Kunde inte läsa serverkonfiguration');
      setCapabilities(null);
      setMe(null);
    });
  }, []);

  async function resolveMerge(confirmMerge: boolean) {
    setBusy('merge'); setError(null);
    try {
      await api(confirmMerge ? '/api/account-merge/confirm' : '/api/account-merge/cancel', { method: 'POST' });
      setMerge(null);
      window.history.replaceState({}, '', '/');
      if (confirmMerge) {
        setMe(await api<Me>('/api/me'));
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte behandla sammanslagningen');
    } finally { setBusy(null); }
  }

  async function unlinkIdentity(provider: 'github' | 'google') {
    if (!me || me.identities.length <= 1) return;
    const label = provider === 'github' ? 'GitHub' : 'Google';
    if (!window.confirm('Vill du ta bort kopplingen till ' + label + '? Du kommer inte längre att kunna logga in med det kontot. Dina prototyper finns kvar.')) return;
    setBusy('unlink-' + provider);
    setError(null);
    try {
      await api('/api/me/identities/' + provider, { method: 'DELETE' });
      setMe(await api<Me>('/api/me'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort kontokopplingen');
    } finally {
      setBusy(null);
    }
  }

  async function createMcpToken() {
    setBusy('mcp-token'); setError(null);
    try {
      const issued = await api<{ token: string; expiresAt: string }>('/api/mcp-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 90 }),
      });
      setMcpToken(issued);
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte skapa MCP-token'); }
    finally { setBusy(null); }
  }

  async function revokeMcpTokens() {
    if (!confirm('Återkalla alla aktiva MCP bearer tokens?')) return;
    setBusy('mcp-revoke'); setError(null);
    try {
      await api('/api/mcp-tokens', { method: 'DELETE' });
      setMcpToken(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte återkalla MCP-token'); }
    finally { setBusy(null); }
  }

  async function copyMcpToken() {
    if (!mcpToken) return;
    await navigator.clipboard.writeText(mcpToken.token);
  }

  async function createPreview(event: FormEvent) {
    event.preventDefault();
    setBusy('create'); setError(null);
    try {
      if (mode === 'upload') {
        if (!file) throw new Error('Välj en ZIP- eller tar.gz-fil');
        if (capabilities && file.size > capabilities.artifact.maxCompressedBytes) throw new Error('Filen är större än serverns tillåtna maxstorlek');
        const body = new FormData();
        body.append('artifact', file);
        body.append('lifetimeMinutes', ttl);
        if (name.trim()) body.append('name', name.trim());
        await api('/api/previews', { method: 'POST', body });
      } else {
        if (!sourceUrl.trim()) throw new Error('Ange en HTTPS-URL');
        await api('/api/previews', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sourceUrl: sourceUrl.trim(), lifetimeMinutes: Number(ttl), name: name.trim() || undefined }),
        });
      }
      setName(''); setSourceUrl(''); setFile(null); setShowCreate(false);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte skapa preview'); }
    finally { setBusy(null); }
  }

  async function promote(preview: Preview) {
    const slug = window.prompt('Adressnamn för permanent publicering:', 'min-prototyp');
    if (slug === null) return;
    setBusy(preview.previewId);
    try {
      await api('/api/previews/' + preview.previewId + '/promote', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({slug})});
      await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'Publiceringen misslyckades'); }
    finally { setBusy(null); }
  }
  async function extend(preview: Preview) {
    if (!capabilities) return;
    const minutes = Number(prompt('Ny livslängd från nu, i minuter:', String(capabilities.preview.ttlMinutes.default)));
    if (!Number.isFinite(minutes)) return;
    setBusy(preview.previewId); setError(null);
    try {
      await api(`/api/previews/${preview.previewId}/extend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lifetimeMinutes: minutes }) });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte förlänga preview'); }
    finally { setBusy(null); }
  }

  async function remove(preview: Preview) {
    if (!confirm('Radera ' + (preview.name || preview.previewId) + (preview.slug ? ' och permanent URL ' + preview.url : '') + '?')) return;
    setBusy(preview.previewId); setError(null);
    try { await api(`/api/previews/${preview.previewId}`, { method: 'DELETE' }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte radera preview'); }
    finally { setBusy(null); }
  }

  async function update(preview: Preview, chosen: File | null) {
    if (!chosen) return;
    setBusy(preview.previewId); setError(null);
    try {
      if (capabilities && chosen.size > capabilities.artifact.maxCompressedBytes) throw new Error('Filen är större än serverns tillåtna maxstorlek');
      const body = new FormData(); body.append('artifact', chosen);
      await api(`/api/previews/${preview.previewId}/content`, { method: 'PUT', body });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte uppdatera preview'); }
    finally { setBusy(null); }
  }

  if (me === undefined || capabilities === undefined) return <main className="center"><div className="spinner" aria-label="Laddar" /></main>;
  if (capabilities === null) return <main className="center"><div className="alert" role="alert">{error ?? 'Kunde inte läsa serverkonfiguration'}</div></main>;
  if (me === null) return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">P</div>
        <p className="eyebrow">PWA Preview</p>
        <h1>Publicera en färdig PWA på några sekunder.</h1>
        <p>Logga in för att skapa, uppdatera och hantera dina publicerade prototyper.</p>
        <div className="login-actions">
          <a className="button primary wide" href="/auth/login/github">Fortsätt med GitHub</a>
          {googleEnabled && <a className="button primary wide" href="/auth/login/google">Fortsätt med Google</a>}
        </div>
      </section>
    </main>
  );

  return (
    <main className="page-shell">
      <header className="topbar">
        <div><p className="eyebrow">PWA Preview</p><h1>{page === 'settings' ? 'Inställningar' : 'Mina previews'}</h1></div>
        <nav className="header-actions" aria-label="Huvudnavigation">
          {page === 'settings' ? <button className="button ghost" onClick={() => navigate('previews')}>← Mina previews</button> : <button className="button ghost" onClick={() => navigate('settings')}>Inställningar</button>}
          <form method="post" action="/auth/logout"><button className="button ghost">Logga ut</button></form>
        </nav>
      </header>
      {merge && <section className="access-card" role="dialog" aria-modal="true" aria-labelledby="merge-heading">
        <div className="section-heading"><div><p className="eyebrow">Kontokoppling</p><h2 id="merge-heading">Vill du slå samman dina konton?</h2></div></div>
        <p className="access-help">Ditt {merge.provider === 'github' ? 'GitHub' : 'Google'}-konto är redan kopplat till ett annat PWA Preview-konto. Du har nu autentiserat båda kontona.</p>
        <div className="merge-stats">
          <div><strong>Nuvarande konto</strong><p>{merge.currentPreviews} aktiva prototyper, {merge.currentPermanent} permanenta</p></div>
          <div><strong>Andra kontot</strong><p>{merge.otherPreviews} aktiva prototyper, {merge.otherPermanent} permanenta</p></div>
        </div>
        <p>Vid sammanslagning behålls dina publiceringar och båda inloggningsmetoderna. Det andra kontots sessioner och MCP-token upphör att gälla. Åtgärden kan inte ångras automatiskt.</p>
        <div className="header-actions">
          <button className="button ghost" disabled={busy === 'merge'} onClick={() => void resolveMerge(false)}>Avbryt</button>
          <button className="button primary" disabled={busy === 'merge'} onClick={() => void resolveMerge(true)}>Slå samman konton</button>
        </div>
      </section>}
      {error && <div className="alert" role="alert">{error}<button onClick={() => setError(null)}>×</button></div>}

      {page === 'settings' && <div className="settings-content">
      <section className="access-card">
        <div className="section-heading">
          <div><p className="eyebrow">Konto</p><h2>Inloggningsmetoder</h2></div>
        </div>
        <div className="identity-list">
          {me.identities.filter(identity => identity.provider === 'github' || identity.provider === 'google').map(identity => (
            <div className="identity-item" key={identity.provider}>
              <div><strong>{identity.provider === 'github' ? 'GitHub' : 'Google'} – kopplat</strong><p>{identity.email ?? 'Verifierat konto'}</p></div>
              <button className="button ghost" type="button"
                disabled={me.identities.length <= 1 || busy !== null}
                title={me.identities.length <= 1 ? 'Den sista inloggningsmetoden kan inte tas bort' : 'Ta bort kontokopplingen'}
                onClick={() => void unlinkIdentity(identity.provider as 'github' | 'google')}>Ta bort koppling</button>
            </div>
          ))}
        </div>
        {!me.identities.some(identity => identity.provider === 'github') &&
          <a className="button ghost" href="/auth/login/github?link=true">Koppla GitHub-konto</a>}
        {googleEnabled && !me.identities.some(identity => identity.provider === 'google') &&
          <a className="button ghost" href="/auth/login/google?link=true">Koppla Google-konto</a>}
        {me.identities.length <= 1 && <p className="access-help">Du behöver minst en kopplad inloggningsmetod.</p>}
      </section>
      <section className="access-card">
        <div className="section-heading">
          <div><p className="eyebrow">Integration</p><h2>MCP access</h2></div>
          <div className="header-actions">
            <button className="button ghost" onClick={createMcpToken} disabled={busy==='mcp-token'}>{busy==='mcp-token'?'Skapar…':'Skapa bearer token'}</button>
            <button className="button danger" onClick={revokeMcpTokens} disabled={busy==='mcp-revoke'}>Återkalla tokens</button>
          </div>
        </div>
        <p className="access-help">ChatGPT kan ansluta med OAuth mot <code>{'https://' + window.location.host + '/mcp'}</code>. Bearer token finns kvar för script, felsökning och andra MCP-klienter.</p>
        {mcpToken && <div className="token-box">
          <div><span>Bearer token — visas bara nu</span><code>{mcpToken.token}</code><small>Giltig till {formatDate(mcpToken.expiresAt)}</small></div>
          <button className="button ghost" onClick={copyMcpToken}>Kopiera</button>
        </div>}
      </section>

      </div>}
      {page === 'previews' && <>
        <section className="dashboard-hero">
          <div><p className="eyebrow">Översikt</p><h2>Dina publicerade prototyper</h2><p>Öppna och hantera dina previews eller publicera en ny.</p></div>
          <button className="button primary" onClick={() => setShowCreate(true)}>+ Ny preview</button>
        </section>
        <div className="dashboard-stats"><div><strong>{activeCount}</strong><span>Aktiva</span></div><div><strong>{previews.length - permanentCount}</strong><span>Tillfälliga</span></div><div><strong>{permanentCount}</strong><span>Permanenta</span></div></div>
        {showCreate && <div className="dialog-backdrop" onClick={() => setShowCreate(false)}><div className="dialog-panel" onClick={e => e.stopPropagation()}>      <section className="create-card" role="dialog" aria-modal="true" aria-label="Ny preview">
        <div className="section-heading"><div><p className="eyebrow">Ny preview</p><h2>Publicera statiskt innehåll</h2></div><button className="button ghost" onClick={() => setShowCreate(false)} aria-label="Stäng">✕</button></div><div className="segmented"><button className={mode==='upload'?'active':''} onClick={() => setMode('upload')}>Fil</button><button className={mode==='url'?'active':''} onClick={() => setMode('url')}>URL</button></div>
        <form className="create-grid" onSubmit={createPreview}>
          <label>Namn<span>Valfritt</span><input value={name} maxLength={capabilities.preview.name.maxLength} onChange={e=>setName(e.target.value)} placeholder="Min prototyp" /></label>
          <label>Livslängd<span>{capabilities.preview.ttlMinutes.min}–{capabilities.preview.ttlMinutes.max} minuter</span><input type="number" min={capabilities.preview.ttlMinutes.min} max={capabilities.preview.ttlMinutes.max} value={ttl} onChange={e=>setTtl(e.target.value)} /></label>
          {mode === 'upload' ? <label className="source-field">Artifact<span>ZIP eller tar.gz</span><input type="file" accept=".zip,.gz,.tgz,application/zip,application/gzip" onChange={e=>setFile(e.target.files?.[0] ?? null)} /></label> : <label className="source-field">HTTPS-URL<span>Signerad URL stöds</span><input type="url" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://…/artifact.zip" /></label>}
          <button className="button primary submit" disabled={busy==='create'}>{busy==='create'?'Publicerar…':'Skapa preview'}</button>
        </form>
      </section>

</div></div>}
      <section className="list-section">
        <div className="section-heading"><div><p className="eyebrow">Publiceringar</p><h2>Previews</h2></div><div className="segmented" aria-label="Filtrera previews"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Alla</button><button className={filter==='temporary'?'active':''} onClick={()=>setFilter('temporary')}>Tillfälliga</button><button className={filter==='permanent'?'active':''} onClick={()=>setFilter('permanent')}>Permanenta</button></div></div>
        {sorted.length === 0 ? <div className="empty"><strong>Inga previews ännu</strong><p>Välj Ny preview för att publicera din första prototyp.</p></div> : <div className="cards">{sorted.map(preview => (
          <article className="preview-card" key={preview.previewId}>
            <div className="preview-main"><div className="preview-title"><span className={`status ${preview.status.toLowerCase()}`}>{preview.status}</span><h3>{preview.name || 'Namnlös preview'}</h3><code>{preview.previewId}</code></div></div>
            <div className="meta-grid"><div><span>Utgår</span><strong>{preview.expiresAt ? formatDate(preview.expiresAt) : 'Permanent'}</strong></div><div><span>Källa</span><strong>{preview.sourceType}</strong></div><div><span>Storlek</span><strong>{formatBytes(preview.extractedSizeBytes)}</strong></div><div><span>Filer</span><strong>{preview.fileCount ?? '–'}</strong></div></div>
            <div className="card-actions">
              <a className="button primary" href={preview.url} target="_blank" rel="noreferrer">Öppna ↗</a>
              <button className="button ghost" onClick={() => setMenuId(menuId === preview.previewId ? null : preview.previewId)} aria-expanded={menuId===preview.previewId} aria-label="Fler åtgärder">Fler åtgärder ⋯</button>
            </div>
            {menuId === preview.previewId && <div className="secondary-actions">
              <a className="button ghost" href={`/api/previews/${preview.previewId}/download`} aria-disabled={preview.status !== 'READY'} onClick={e=>{if(preview.status!=='READY')e.preventDefault();}}>Ladda ned ZIP</a>
              <label className="button ghost upload-button">Uppdatera<input type="file" accept=".zip,.gz,.tgz,application/zip,application/gzip" onChange={e=>{void update(preview,e.target.files?.[0] ?? null);e.currentTarget.value='';}} disabled={busy===preview.previewId} /></label>
              {preview.publicationMode === 'TEMPORARY' && <><button className="button ghost" onClick={()=>promote(preview)} disabled={busy===preview.previewId || preview.status!=='READY'}>Behåll permanent</button><button className="button ghost" onClick={()=>extend(preview)} disabled={busy===preview.previewId}>Förläng</button></>}
              <button className="button danger" onClick={()=>remove(preview)} disabled={busy===preview.previewId}>Radera</button>
            </div>}
          </article>
        ))}</div>}
      </section>

      </>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

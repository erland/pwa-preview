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

type Me = { userId: string };

type RuntimeCapabilities = {
  preview: {
    ttlMinutes: { min: number; default: number; max: number };
    name: { maxLength: number };
    sourceUrl: { requiresHttps: true };
  };
  artifact: { maxCompressedBytes: number };
};

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
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

  const sorted = useMemo(() => [...previews].sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [previews]);

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
      api<RuntimeCapabilities>('/api/capabilities'),
      api<Me>('/api/me').then((value) => ({ authenticated: true as const, value })).catch(() => ({ authenticated: false as const })),
    ]).then(([runtime, identity]) => {
      setCapabilities(runtime);
      setTtl(String(runtime.preview.ttlMinutes.default));
      if (!identity.authenticated) {
        setMe(null);
        return;
      }
      setMe(identity.value);
      return refresh();
    }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Kunde inte läsa serverkonfiguration');
      setCapabilities(null);
      setMe(null);
    });
  }, []);

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
      setName(''); setSourceUrl(''); setFile(null);
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
    if (!confirm(`Radera ${preview.name || preview.previewId}?`)) return;
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
        <p>Logga in med GitHub för att skapa, uppdatera och hantera tillfälliga previews.</p>
        <a className="button primary wide" href="/auth/login/github">Fortsätt med GitHub</a>
      </section>
    </main>
  );

  return (
    <main className="page-shell">
      <header className="topbar">
        <div><p className="eyebrow">PWA Preview</p><h1>Mina previews</h1></div>
        <div className="header-actions"><button className="button ghost" onClick={refresh}>Uppdatera</button><form method="post" action="/auth/logout"><button className="button ghost">Logga ut</button></form></div>
      </header>

      {error && <div className="alert" role="alert">{error}<button onClick={() => setError(null)}>×</button></div>}

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

      <section className="create-card">
        <div className="section-heading"><div><p className="eyebrow">Ny preview</p><h2>Publicera statiskt innehåll</h2></div><div className="segmented"><button className={mode==='upload'?'active':''} onClick={() => setMode('upload')}>Fil</button><button className={mode==='url'?'active':''} onClick={() => setMode('url')}>URL</button></div></div>
        <form className="create-grid" onSubmit={createPreview}>
          <label>Namn<span>Valfritt</span><input value={name} maxLength={capabilities.preview.name.maxLength} onChange={e=>setName(e.target.value)} placeholder="Min prototyp" /></label>
          <label>Livslängd<span>{capabilities.preview.ttlMinutes.min}–{capabilities.preview.ttlMinutes.max} minuter</span><input type="number" min={capabilities.preview.ttlMinutes.min} max={capabilities.preview.ttlMinutes.max} value={ttl} onChange={e=>setTtl(e.target.value)} /></label>
          {mode === 'upload' ? <label className="source-field">Artifact<span>ZIP eller tar.gz</span><input type="file" accept=".zip,.gz,.tgz,application/zip,application/gzip" onChange={e=>setFile(e.target.files?.[0] ?? null)} /></label> : <label className="source-field">HTTPS-URL<span>Signerad URL stöds</span><input type="url" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://…/artifact.zip" /></label>}
          <button className="button primary submit" disabled={busy==='create'}>{busy==='create'?'Publicerar…':'Skapa preview'}</button>
        </form>
      </section>

      <section className="list-section">
        <div className="section-heading"><div><p className="eyebrow">Aktiva</p><h2>{sorted.length} preview{sorted.length === 1 ? '' : 's'}</h2></div></div>
        {sorted.length === 0 ? <div className="empty"><strong>Inga previews ännu</strong><p>Skapa din första preview ovan.</p></div> : <div className="cards">{sorted.map(preview => (
          <article className="preview-card" key={preview.previewId}>
            <div className="preview-main"><div className="preview-title"><span className={`status ${preview.status.toLowerCase()}`}>{preview.status}</span><h3>{preview.name || 'Namnlös preview'}</h3><code>{preview.previewId}</code></div><a className="open-link" href={preview.url} target="_blank" rel="noreferrer">Öppna ↗</a></div>
            <div className="meta-grid"><div><span>Utgår</span><strong>{preview.expiresAt ? formatDate(preview.expiresAt) : 'Permanent'}</strong></div><div><span>Källa</span><strong>{preview.sourceType}</strong></div><div><span>Storlek</span><strong>{formatBytes(preview.extractedSizeBytes)}</strong></div><div><span>Filer</span><strong>{preview.fileCount ?? '–'}</strong></div></div>
            <div className="card-actions"><a className="button ghost" href={`/api/previews/${preview.previewId}/download`} aria-disabled={preview.status !== 'READY'} onClick={e=>{if(preview.status!=='READY')e.preventDefault();}}>Ladda ned ZIP</a><label className="button ghost upload-button">Uppdatera<input type="file" accept=".zip,.gz,.tgz,application/zip,application/gzip" onChange={e=>{void update(preview,e.target.files?.[0] ?? null); e.currentTarget.value='';}} disabled={busy===preview.previewId} /></label>{preview.publicationMode === "TEMPORARY" && <><button className="button ghost" onClick={()=>promote(preview)} disabled={busy===preview.previewId || preview.status !== "READY"}>Behåll permanent</button><button className="button ghost" onClick={()=>extend(preview)} disabled={busy===preview.previewId}>Förläng</button></>}<button className="button danger" onClick={()=>remove(preview)} disabled={busy===preview.previewId}>Radera</button></div>
          </article>
        ))}</div>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

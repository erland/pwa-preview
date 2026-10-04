import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import type { LocalPreviewStorage } from '../storage/local-preview-storage.js';
import { previewStorageKey } from '../storage/storage-key.js';

const MIME: Record<string,string> = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.xml':'application/xml'};

function safePath(root:string, requestPath:string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(requestPath.split('?',1)[0]!); } catch { return null; }
  const rel = decoded.replace(/^\/+/, '');
  if (rel.includes('\0')) return null;
  const resolved = path.resolve(root, rel || 'index.html');
  const relative = path.relative(root, resolved);
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : resolved;
}

export async function servePreview(req: FastifyRequest, reply: FastifyReply, previewId:string, repository:PreviewRepository, store:LocalPreviewStorage): Promise<void> {
  const preview = await repository.findReadyById(previewId);
  if (!preview || preview.expiresAt <= new Date()) { await reply.code(404).send({error:'PREVIEW_NOT_FOUND'}); return; }
  const root = store.getPreviewSiteRoot(previewStorageKey(previewId));
  let target = safePath(root, req.url);
  if (!target) { await reply.code(404).send(); return; }
  let info = await stat(target).catch(()=>null);
  if (!info?.isFile()) {
    const pathname = req.url.split('?',1)[0]!;
    const looksLikeAsset = path.posix.basename(pathname).includes('.');
    if (looksLikeAsset) { await reply.code(404).send(); return; }
    target = path.join(root,'index.html');
    info = await stat(target).catch(()=>null);
    if (!info?.isFile()) { await reply.code(404).send(); return; }
  }
  reply.header('X-Content-Type-Options','nosniff');
  reply.header('X-Robots-Tag','noindex, nofollow');
  reply.header('Referrer-Policy','no-referrer');
  reply.header('Cache-Control', path.extname(target)==='.html' ? 'no-store' : 'no-cache');
  reply.header('Content-Length', String(info.size));
  reply.type(MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream');
  if (req.method === 'HEAD') { await reply.send(); return; }
  await reply.send(createReadStream(target));
}

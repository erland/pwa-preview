import https from 'node:https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { SsrfPolicy } from './ssrf-policy.js';

export type DownloadHopResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'body'; body: Buffer };

export type DownloadHop = (url: URL, address: string, family: 4 | 6, timeoutMs: number, maxBytes: number) => Promise<DownloadHopResult>;

async function defaultDownloadHop(url: URL, address: string, family: 4 | 6, timeoutMs: number, maxBytes: number): Promise<DownloadHopResult> {
  return await new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      timeout: timeoutMs,
      headers: { 'user-agent': 'pwa-preview/1' },
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options !== null && options.all) {
          callback(null, [{ address, family }] as never);
          return;
        }
        callback(null, address, family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if ([301,302,303,307,308].includes(status)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new Error('SOURCE_URL_REDIRECT_WITHOUT_LOCATION'));
        return resolve({ kind: 'redirect', location });
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error(`SOURCE_URL_HTTP_${status}`));
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => resolve({ kind: 'body', body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('SOURCE_URL_TIMEOUT')));
    request.on('error', reject);
    request.end();
  });
}

export class UrlArtifactSource {
  constructor(
    private readonly config: Pick<AppConfig, 'urlFetchTimeoutMs' | 'maxRedirects' | 'maxCompressedBytes'>,
    private readonly policy = new SsrfPolicy(),
    private readonly downloadHop: DownloadHop = defaultDownloadHop,
  ) {}

  async fetch(sourceUrl: string): Promise<{ archivePath: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-url-'));
    const archivePath = path.join(dir, 'artifact');
    try {
      let current = sourceUrl;
      for (let redirects = 0; ; redirects++) {
        const resolved = await this.policy.validateAndResolve(current);
        const result = await this.downloadHop(resolved.url, resolved.address, resolved.family, this.config.urlFetchTimeoutMs, this.config.maxCompressedBytes);
        if (result.kind === 'body') {
          if (result.body.length > this.config.maxCompressedBytes) throw new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT');
          await writeFile(archivePath, result.body);
          return { archivePath, cleanup: async () => rm(dir, { recursive: true, force: true }) };
        }
        if (redirects >= this.config.maxRedirects) throw new Error('SOURCE_URL_TOO_MANY_REDIRECTS');
        current = new URL(result.location, resolved.url).toString();
      }
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
}

import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from '../config.js';
import { SsrfPolicy } from './ssrf-policy.js';

export type DownloadHopResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'body'; bytes: number };

export type DownloadHop = (
  url: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
  maxBytes: number,
  destinationPath: string,
) => Promise<DownloadHopResult>;

async function defaultDownloadHop(
  url: URL,
  address: string,
  family: 4 | 6,
  timeoutMs: number,
  maxBytes: number,
  destinationPath: string,
): Promise<DownloadHopResult> {
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

      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.resume();
        return reject(new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT'));
      }

      let bytes = 0;
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            callback(new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT'));
            return;
          }
          callback(null, chunk);
        },
      });

      void pipeline(
        response,
        limiter,
        createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
      ).then(
        () => resolve({ kind: 'body', bytes }),
        (error) => reject(error),
      );
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
        const result = await this.downloadHop(
          resolved.url,
          resolved.address,
          resolved.family,
          this.config.urlFetchTimeoutMs,
          this.config.maxCompressedBytes,
          archivePath,
        );
        if (result.kind === 'body') {
          if (result.bytes > this.config.maxCompressedBytes) throw new Error('ARTIFACT_COMPRESSED_SIZE_LIMIT');
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

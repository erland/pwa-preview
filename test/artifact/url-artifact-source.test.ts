import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { SsrfPolicy } from '../../src/artifact/ssrf-policy.js';
import { UrlArtifactSource, type DownloadHop } from '../../src/artifact/url-artifact-source.js';

const config = { urlFetchTimeoutMs:1000, maxRedirects:2, maxCompressedBytes:1000 };

describe('UrlArtifactSource', () => {
  it('downloads an allowed HTTPS artifact', async () => {
    const policy = new SsrfPolicy(async () => [{ address:'1.1.1.1', family:4 }]);
    const hop: DownloadHop = async () => ({ kind:'body', body:Buffer.from('abc') });
    const source = new UrlArtifactSource(config, policy, hop);
    const result = await source.fetch('https://example.com/a.zip');
    try { expect(await readFile(result.archivePath, 'utf8')).toBe('abc'); } finally { await result.cleanup(); }
  });

  it('revalidates redirect destinations and blocks private targets', async () => {
    const policy = new SsrfPolicy(async (host) => host === 'good.example' ? [{address:'1.1.1.1',family:4}] : [{address:'127.0.0.1',family:4}]);
    const hop: DownloadHop = async () => ({ kind:'redirect', location:'https://bad.example/a.zip' });
    const source = new UrlArtifactSource(config, policy, hop);
    await expect(source.fetch('https://good.example/a.zip')).rejects.toThrow('SOURCE_URL_TARGET_FORBIDDEN');
  });

  it('enforces redirect count', async () => {
    const policy = new SsrfPolicy(async () => [{address:'1.1.1.1',family:4}]);
    const hop: DownloadHop = async (url) => ({ kind:'redirect', location:`https://${url.hostname}/next` });
    const source = new UrlArtifactSource({ ...config, maxRedirects:1 }, policy, hop);
    await expect(source.fetch('https://example.com/a.zip')).rejects.toThrow('SOURCE_URL_TOO_MANY_REDIRECTS');
  });
});

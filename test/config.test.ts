import { describe, expect, it } from 'vitest';
import { loadConfig, safeConfigSummary } from '../src/config.js';

const baseEnv = {
  CONTROL_PLANE_HOST: 'pwa-preview.apps.example.test',
  PREVIEW_DOMAIN_SUFFIX: 'preview.example.test',
  DATABASE_URL: 'postgres://user:password@localhost:5432/pwa_preview',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
} as const;

describe('configuration', () => {
  it('loads deterministic safe defaults', () => {
    const config = loadConfig(baseEnv);
    expect(config).toMatchObject({
      controlPlaneHost: 'pwa-preview.apps.example.test',
      previewDomainSuffix: 'preview.example.test',
      dataRoot: '/data',
      ttlMinMinutes: 5,
      ttlDefaultMinutes: 30,
      ttlMaxMinutes: 1440,
      maxCompressedBytes: 100 * 1024 * 1024,
      maxExtractedBytes: 500 * 1024 * 1024,
      maxFileCount: 20_000,
      maxPathLength: 1024,
      urlFetchTimeoutMs: 30_000,
      maxRedirects: 5,
      maxActivePreviewsPerUser: 20,
      maxConcurrentImportsPerUser: 2,
      maxStorageBytesPerUser: 2 * 1024 * 1024 * 1024,
      maxStorageBytesTotal: 20 * 1024 * 1024 * 1024,
    });
  });


  it('rejects filesystem root as DATA_ROOT', () => {
    expect(() => loadConfig({ ...baseEnv, DATA_ROOT: '/' }))
      .toThrow('DATA_ROOT must not be the filesystem root');
  });

  it('rejects an invalid TTL ordering', () => {
    expect(() => loadConfig({ ...baseEnv, TTL_MIN_MINUTES: '60', TTL_DEFAULT_MINUTES: '30' }))
      .toThrow('TTL must satisfy min <= default <= max');
  });

  it('rejects a short session secret', () => {
    expect(() => loadConfig({ ...baseEnv, SESSION_SECRET: 'too-short' }))
      .toThrow('SESSION_SECRET must be at least 32 characters');
  });

  it('rejects invalid numeric limits', () => {
    expect(() => loadConfig({ ...baseEnv, MAX_FILE_COUNT: '0' }))
      .toThrow('MAX_FILE_COUNT must be a positive integer');
    expect(() => loadConfig({ ...baseEnv, MAX_ACTIVE_PREVIEWS_PER_USER: '0' }))
      .toThrow('MAX_ACTIVE_PREVIEWS_PER_USER must be a positive integer');
    expect(() => loadConfig({ ...baseEnv, MAX_CONCURRENT_IMPORTS_PER_USER: '0' }))
      .toThrow('MAX_CONCURRENT_IMPORTS_PER_USER must be a positive integer');
    expect(() => loadConfig({ ...baseEnv, MAX_STORAGE_BYTES_PER_USER: '0' }))
      .toThrow('MAX_STORAGE_BYTES_PER_USER must be a positive integer');
    expect(() => loadConfig({ ...baseEnv, MAX_STORAGE_BYTES_TOTAL: '0' }))
      .toThrow('MAX_STORAGE_BYTES_TOTAL must be a positive integer');
  });

  it('does not expose secrets in the safe summary', () => {
    const config = loadConfig(baseEnv);
    const summary = safeConfigSummary(config);
    expect(summary).not.toHaveProperty('sessionSecret');
    expect(summary).not.toHaveProperty('githubClientSecret');
    expect(summary).not.toHaveProperty('databaseUrl');
    expect(JSON.stringify(summary)).not.toContain('password');
  });
});

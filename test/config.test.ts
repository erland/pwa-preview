import { describe, expect, it } from 'vitest';
import { loadConfig, safeConfigSummary } from '../src/config.js';

const baseEnv = {
  CONTROL_PLANE_HOST: 'pwa-preview.apps.example.test',
  CONTROL_PLANE_REGISTRABLE_DOMAIN: 'example.test',
  PREVIEW_DOMAIN_SUFFIX: 'preview.example-preview.test',
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
      controlPlaneRegistrableDomain: 'example.test',
      previewDomainSuffix: 'preview.example-preview.test',
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


  it('builds DATABASE_URL from runtime DB variables when DATABASE_URL is absent', () => {
    const { DATABASE_URL: _databaseUrl, ...withoutDatabaseUrl } = baseEnv;
    const config = loadConfig({
      ...withoutDatabaseUrl,
      DB_HOST: 'postgres.internal',
      DB_USER: 'pwa_preview',
      DB_PASSWORD: 'p@ss/word',
      DB_NAME: 'pwa_preview',
    });
    expect(config.databaseUrl).toBe('postgres://pwa_preview:p%40ss%2Fword@postgres.internal:5432/pwa_preview');
  });

  it('keeps explicit DATABASE_URL supported', () => {
    expect(loadConfig(baseEnv).databaseUrl).toBe(baseEnv.DATABASE_URL);
  });

  it('requires runtime DB variables when DATABASE_URL is absent', () => {
    const { DATABASE_URL: _databaseUrl, ...withoutDatabaseUrl } = baseEnv;
    expect(() => loadConfig(withoutDatabaseUrl)).toThrow('Missing required configuration: DB_USER');
  });

  it('leaves GitHub allowlist sync disabled when the variable is absent or empty', () => {
    expect(loadConfig(baseEnv).githubAllowlistEmails).toBeUndefined();
    expect(loadConfig({ ...baseEnv, PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS: '   ' }).githubAllowlistEmails).toBeUndefined();
  });

  it('parses, normalizes and deduplicates configured GitHub allowlist emails', () => {
    const config = loadConfig({
      ...baseEnv,
      PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS: ' User@Example.Test,second@example.test,user@example.test ',
    });
    expect(config.githubAllowlistEmails).toEqual(['user@example.test', 'second@example.test']);
  });

  it('rejects malformed configured GitHub allowlist emails', () => {
    expect(() => loadConfig({ ...baseEnv, PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS: 'not-an-email' }))
      .toThrow('PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS must contain comma-separated email addresses');
  });

  it('rejects preview hosts inside the control-plane registrable domain by default', () => {
    expect(() => loadConfig({ ...baseEnv, PREVIEW_DOMAIN_SUFFIX: 'preview.example.test' }))
      .toThrow('PREVIEW_DOMAIN_SUFFIX must use a separate registrable domain unless ALLOW_SAME_SITE_PREVIEWS=true');
  });

  it('allows same-site preview hosts only with explicit opt-in', () => {
    const config = loadConfig({
      ...baseEnv,
      CONTROL_PLANE_HOST: 'pwa-preview.apphome.one',
      CONTROL_PLANE_REGISTRABLE_DOMAIN: 'apphome.one',
      PREVIEW_DOMAIN_SUFFIX: 'preview.apphome.one',
      ALLOW_SAME_SITE_PREVIEWS: 'true',
    });
    expect(config.allowSameSitePreviews).toBe(true);
    expect(config.previewDomainSuffix).toBe('preview.apphome.one');
  });

  it('rejects a control-plane host outside its declared registrable domain', () => {
    expect(() => loadConfig({ ...baseEnv, CONTROL_PLANE_REGISTRABLE_DOMAIN: 'other.test' }))
      .toThrow('CONTROL_PLANE_HOST must be within CONTROL_PLANE_REGISTRABLE_DOMAIN');
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

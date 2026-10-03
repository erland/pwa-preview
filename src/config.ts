export type AppConfig = Readonly<{
  controlPlaneHost: string;
  controlPlaneRegistrableDomain: string;
  previewDomainSuffix: string;
  databaseUrl: string;
  dataRoot: string;
  sessionSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  ttlMinMinutes: number;
  ttlDefaultMinutes: number;
  ttlMaxMinutes: number;
  maxCompressedBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxPathLength: number;
  urlFetchTimeoutMs: number;
  maxRedirects: number;
  maxActivePreviewsPerUser: number;
  maxConcurrentImportsPerUser: number;
  maxStorageBytesPerUser: number;
  maxStorageBytesTotal: number;
  cleanupIntervalMs: number;
  reconciliationIntervalMs: number;
  staleOperationMinutes: number;
  staleStagingMinutes: number;
  migrateOnStart: boolean;
}>;

type Env = Readonly<Record<string, string | undefined>>;

const MIB = 1024 * 1024;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${key}`);
  return value;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid configuration: ${key} must be a positive integer`);
  }
  return value;
}

function booleanValue(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  throw new Error(`Invalid configuration: ${key} must be true or false`);
}

function host(value: string, key: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.startsWith('.') || trimmed.endsWith('.')) {
    throw new Error(`Invalid configuration: ${key} must be a DNS host name`);
  }
  return trimmed;
}

function absolutePath(value: string, key: string): string {
  if (!value.startsWith('/')) throw new Error(`Invalid configuration: ${key} must be an absolute path`);
  const normalized = value.replace(/\/$/, '') || '/';
  if (normalized === '/') throw new Error(`Invalid configuration: ${key} must not be the filesystem root`);
  return normalized;
}


export function loadConfig(env: Env = process.env): AppConfig {
  const ttlMinMinutes = positiveInt(env, 'TTL_MIN_MINUTES', 5);
  const ttlDefaultMinutes = positiveInt(env, 'TTL_DEFAULT_MINUTES', 30);
  const ttlMaxMinutes = positiveInt(env, 'TTL_MAX_MINUTES', 24 * 60);

  if (!(ttlMinMinutes <= ttlDefaultMinutes && ttlDefaultMinutes <= ttlMaxMinutes)) {
    throw new Error('Invalid configuration: TTL must satisfy min <= default <= max');
  }

  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new Error('Invalid configuration: SESSION_SECRET must be at least 32 characters');
  }

  const controlPlaneHost = host(required(env, 'CONTROL_PLANE_HOST'), 'CONTROL_PLANE_HOST');
  const controlPlaneRegistrableDomain = host(required(env, 'CONTROL_PLANE_REGISTRABLE_DOMAIN'), 'CONTROL_PLANE_REGISTRABLE_DOMAIN');
  const previewDomainSuffix = host(required(env, 'PREVIEW_DOMAIN_SUFFIX'), 'PREVIEW_DOMAIN_SUFFIX');

  if (controlPlaneHost !== controlPlaneRegistrableDomain && !controlPlaneHost.endsWith(`.${controlPlaneRegistrableDomain}`)) {
    throw new Error('Invalid configuration: CONTROL_PLANE_HOST must be within CONTROL_PLANE_REGISTRABLE_DOMAIN');
  }
  if (previewDomainSuffix === controlPlaneRegistrableDomain || previewDomainSuffix.endsWith(`.${controlPlaneRegistrableDomain}`)) {
    throw new Error('Invalid configuration: PREVIEW_DOMAIN_SUFFIX must use a separate registrable domain');
  }

  return Object.freeze({
    controlPlaneHost,
    controlPlaneRegistrableDomain,
    previewDomainSuffix,
    databaseUrl: required(env, 'DATABASE_URL'),
    dataRoot: absolutePath(env.DATA_ROOT?.trim() || '/data', 'DATA_ROOT'),
    sessionSecret,
    githubClientId: required(env, 'GITHUB_CLIENT_ID'),
    githubClientSecret: required(env, 'GITHUB_CLIENT_SECRET'),
    ttlMinMinutes,
    ttlDefaultMinutes,
    ttlMaxMinutes,
    maxCompressedBytes: positiveInt(env, 'MAX_COMPRESSED_BYTES', 100 * MIB),
    maxExtractedBytes: positiveInt(env, 'MAX_EXTRACTED_BYTES', 500 * MIB),
    maxFileCount: positiveInt(env, 'MAX_FILE_COUNT', 20_000),
    maxPathLength: positiveInt(env, 'MAX_PATH_LENGTH', 1024),
    urlFetchTimeoutMs: positiveInt(env, 'URL_FETCH_TIMEOUT_MS', 30_000),
    maxRedirects: positiveInt(env, 'MAX_REDIRECTS', 5),
    maxActivePreviewsPerUser: positiveInt(env, 'MAX_ACTIVE_PREVIEWS_PER_USER', 20),
    maxConcurrentImportsPerUser: positiveInt(env, 'MAX_CONCURRENT_IMPORTS_PER_USER', 2),
    maxStorageBytesPerUser: positiveInt(env, 'MAX_STORAGE_BYTES_PER_USER', 2 * 1024 * MIB),
    maxStorageBytesTotal: positiveInt(env, 'MAX_STORAGE_BYTES_TOTAL', 20 * 1024 * MIB),
    cleanupIntervalMs: positiveInt(env, 'CLEANUP_INTERVAL_MS', 60_000),
    reconciliationIntervalMs: positiveInt(env, 'RECONCILIATION_INTERVAL_MS', 10 * 60_000),
    staleOperationMinutes: positiveInt(env, 'STALE_OPERATION_MINUTES', 30),
    staleStagingMinutes: positiveInt(env, 'STALE_STAGING_MINUTES', 60),
    migrateOnStart: booleanValue(env, 'MIGRATE_ON_START', true),
  });
}

export function safeConfigSummary(config: AppConfig): Record<string, string | number> {
  return {
    controlPlaneHost: config.controlPlaneHost,
    controlPlaneRegistrableDomain: config.controlPlaneRegistrableDomain,
    previewDomainSuffix: config.previewDomainSuffix,
    dataRoot: config.dataRoot,
    ttlMinMinutes: config.ttlMinMinutes,
    ttlDefaultMinutes: config.ttlDefaultMinutes,
    ttlMaxMinutes: config.ttlMaxMinutes,
    maxCompressedBytes: config.maxCompressedBytes,
    maxExtractedBytes: config.maxExtractedBytes,
    maxFileCount: config.maxFileCount,
    maxPathLength: config.maxPathLength,
    urlFetchTimeoutMs: config.urlFetchTimeoutMs,
    maxRedirects: config.maxRedirects,
    maxActivePreviewsPerUser: config.maxActivePreviewsPerUser,
    maxConcurrentImportsPerUser: config.maxConcurrentImportsPerUser,
    maxStorageBytesPerUser: config.maxStorageBytesPerUser,
    maxStorageBytesTotal: config.maxStorageBytesTotal,
    cleanupIntervalMs: config.cleanupIntervalMs,
    reconciliationIntervalMs: config.reconciliationIntervalMs,
    staleOperationMinutes: config.staleOperationMinutes,
    staleStagingMinutes: config.staleStagingMinutes,
    migrateOnStart: String(config.migrateOnStart),
  };
}

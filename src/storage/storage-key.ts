import { randomBytes } from 'node:crypto';

const STORAGE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type StagingKey = string & { readonly __brand: 'StagingKey' };
export type PreviewStorageKey = string & { readonly __brand: 'PreviewStorageKey' };

function assertStorageKey(value: string, label: string): string {
  if (!STORAGE_KEY_RE.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function randomKey(prefix: string): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`;
}

export function createStagingKey(): StagingKey {
  return assertStorageKey(randomKey('s'), 'staging key') as StagingKey;
}

export function createPreviewStorageKey(): PreviewStorageKey {
  return assertStorageKey(randomKey('p'), 'preview storage key') as PreviewStorageKey;
}

export function stagingKey(value: string): StagingKey {
  return assertStorageKey(value, 'staging key') as StagingKey;
}

export function previewStorageKey(value: string): PreviewStorageKey {
  return assertStorageKey(value, 'preview storage key') as PreviewStorageKey;
}

export function previewStorageKeyFromId(id: string): PreviewStorageKey {
  if (!/^p-[a-f0-9]{32}$/.test(id)) throw new Error('Invalid preview id');
  return id as PreviewStorageKey;
}

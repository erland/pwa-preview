import type { PreviewStorageKey, StagingKey } from './storage-key.js';

/**
 * Filesystem-oriented preview storage contract for the v1 single-instance deployment.
 *
 * This interface intentionally exposes local directory paths and replacement semantics
 * that rely on atomic rename within one filesystem. It is not a provider-neutral
 * object-storage abstraction. A future S3/R2 or multi-instance design should introduce
 * a different contract rather than emulate these path-based guarantees.
 */
export interface PreviewReplacement {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface LocalPreviewStorage {
  initialize(): Promise<void>;
  createStagingArea(): Promise<StagingKey>;
  deleteStagingArea(key: StagingKey): Promise<void>;
  createPreviewArea(key: PreviewStorageKey): Promise<void>;
  deletePreviewArea(key: PreviewStorageKey): Promise<void>;
  getStagingSiteRoot(key: StagingKey): string;
  getPreviewSiteRoot(key: PreviewStorageKey): string;
  replacePreviewSite(key: PreviewStorageKey, sourceDir: string): Promise<PreviewReplacement>;
  listPreviewKeys(): Promise<string[]>;
  deleteStagingOlderThan(before: Date): Promise<number>;
}

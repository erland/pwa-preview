import type { PreviewStorageKey, StagingKey } from './storage-key.js';

export interface PreviewReplacement {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ObjectStore {
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

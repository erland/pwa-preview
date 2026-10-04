import type { LocalPreviewStorage, PreviewReplacement } from '../storage/local-preview-storage.js';
import { previewStorageKey, type StagingKey } from '../storage/storage-key.js';

export class PreviewPublisher {
  constructor(private readonly store: LocalPreviewStorage) {}

  async publish(previewId: string, stagingKey: StagingKey): Promise<void> {
    const replacement = await this.prepareReplacement(previewId, stagingKey);
    await replacement.commit();
  }

  async prepareReplacement(previewId: string, stagingKey: StagingKey): Promise<PreviewReplacement> {
    const key = previewStorageKey(previewId);
    return this.store.replacePreviewSite(key, this.store.getStagingSiteRoot(stagingKey) + '/normalized');
  }
}

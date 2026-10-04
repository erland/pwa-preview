import type { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import type { LocalPreviewStorage } from '../storage/local-preview-storage.js';
import { previewStorageKeyFromId } from '../storage/storage-key.js';

export class CleanupJob {
  constructor(private readonly repository: PreviewRepository, private readonly store: LocalPreviewStorage) {}

  async runOnce(batchSize = 50): Promise<number> {
    const expired = await this.repository.claimExpired(batchSize);
    let cleaned = 0;
    for (const preview of expired) {
      await this.store.deletePreviewArea(previewStorageKeyFromId(preview.id));
      await this.repository.markDeletedSystemFromExpired(preview.id);
      cleaned += 1;
    }
    return cleaned;
  }
}

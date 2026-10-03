import type { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import type { ObjectStore } from '../storage/object-store.js';
import { previewStorageKeyFromId } from '../storage/storage-key.js';

export class CleanupJob {
  constructor(private readonly repository: PreviewRepository, private readonly store: ObjectStore) {}

  async runOnce(batchSize = 50): Promise<number> {
    const expired = await this.repository.claimExpired(batchSize);
    let cleaned = 0;
    for (const preview of expired) {
      await this.store.deletePreviewArea(previewStorageKeyFromId(preview.id));
      await this.repository.markDeletedSystem(preview.id);
      cleaned += 1;
    }
    return cleaned;
  }
}

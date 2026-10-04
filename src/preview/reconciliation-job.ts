import type { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import type { ObjectStore } from '../storage/object-store.js';
import { previewStorageKeyFromId } from '../storage/storage-key.js';

export class ReconciliationJob {
  constructor(private readonly repository: PreviewRepository, private readonly store: ObjectStore) {}

  async runOnce(options: { staleCreatingBefore: Date; staleStagingBefore: Date }): Promise<{completedDeleting:number; failedCreating:number; deletedOrphanPreviews:number; deletedStaging:number}> {
    let completedDeleting = 0;
    for (const preview of await this.repository.listByStatus('DELETING', 100)) {
      await this.store.deletePreviewArea(previewStorageKeyFromId(preview.id));
      await this.repository.markDeletedSystemFromDeleting(preview.id);
      completedDeleting += 1;
    }

    let failedCreating = 0;
    for (const preview of await this.repository.claimStaleCreating(options.staleCreatingBefore, 100)) {
      await this.store.deletePreviewArea(previewStorageKeyFromId(preview.id));
      failedCreating += 1;
    }

    const activeIds = new Set(await this.repository.listActiveIds());
    let deletedOrphanPreviews = 0;
    for (const id of await this.store.listPreviewKeys()) {
      if (activeIds.has(id)) continue;
      if (await this.repository.isActiveId(id)) continue;
      await this.store.deletePreviewArea(previewStorageKeyFromId(id));
      deletedOrphanPreviews += 1;
    }

    const deletedStaging = await this.store.deleteStagingOlderThan(options.staleStagingBefore);
    return { completedDeleting, failedCreating, deletedOrphanPreviews, deletedStaging };
  }
}

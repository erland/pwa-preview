import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LocalPreviewStorage } from '../storage/local-preview-storage.js';
import { detectArchiveFormat } from './archive-format.js';
import { safeExtractArchive } from './safe-extractor.js';
import { detectSiteRoot } from './site-root-detector.js';
import type { ArtifactLimits, ImportedArtifact } from './types.js';

export class ArchiveImporter {
  constructor(private readonly store: LocalPreviewStorage, private readonly limits: ArtifactLimits) {}

  async importFromFile(archivePath: string): Promise<{ stagingKey: Awaited<ReturnType<LocalPreviewStorage['createStagingArea']>>; artifact: ImportedArtifact }> {
    const compressedSizeBytes = (await stat(archivePath)).size;
    if (compressedSizeBytes > this.limits.maxCompressedBytes) throw new Error('Compressed artifact size exceeds limit');
    const format = await detectArchiveFormat(archivePath);
    const stagingKey = await this.store.createStagingArea();
    const root = this.store.getStagingSiteRoot(stagingKey);
    const extractedRoot = path.join(root, '.extracted');
    try {
      await mkdir(extractedRoot, { recursive: true });
      const counters = await safeExtractArchive(archivePath, format, extractedRoot, this.limits);
      const siteRoot = await detectSiteRoot(extractedRoot);
      const normalizedRoot = path.join(root, 'normalized');
      await cp(siteRoot, normalizedRoot, { recursive: true, errorOnExist: true });
      await rm(extractedRoot, { recursive: true, force: true });
      return {
        stagingKey,
        artifact: { format, siteRoot: normalizedRoot, compressedSizeBytes, extractedSizeBytes: counters.bytes, fileCount: counters.files },
      };
    } catch (error) {
      await this.store.deleteStagingArea(stagingKey).catch(() => undefined);
      throw error;
    }
  }
}

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { AppConfig } from '../config.js';
import type { Preview } from '../domain/models.js';
import { ArchiveImporter } from '../artifact/archive-importer.js';
import type { PreviewRepository } from '../persistence/repositories/preview-repository.js';
import type { ObjectStore } from '../storage/object-store.js';
import { previewStorageKey, type StagingKey } from '../storage/storage-key.js';
import { createPreviewId } from './preview-id.js';
import { PreviewPublisher } from './preview-publisher.js';
import { UrlArtifactSource } from '../artifact/url-artifact-source.js';
import { ApplicationError } from '../errors/application-error.js';

const importCounts = new Map<string, number>();
const createLocks = new Map<string, Promise<void>>();
let storageQuotaTail: Promise<void> = Promise.resolve();

async function withImportPermit<T>(userId: string, limit: number, work: () => Promise<T>): Promise<T> {
  const active = importCounts.get(userId) ?? 0;
  if (active >= limit) throw new ApplicationError('IMPORT_CONCURRENCY_LIMIT');
  importCounts.set(userId, active + 1);
  try {
    return await work();
  } finally {
    const next = (importCounts.get(userId) ?? 1) - 1;
    if (next <= 0) importCounts.delete(userId);
    else importCounts.set(userId, next);
  }
}

async function withCreateLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = createLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => gate);
  createLocks.set(userId, chain);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (createLocks.get(userId) === chain) createLocks.delete(userId);
  }
}

async function withStorageQuotaLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = storageQuotaTail;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  storageQuotaTail = previous.then(() => gate);
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export class PreviewService {
  private readonly importer: ArchiveImporter;
  private readonly publisher: PreviewPublisher;
  private readonly urlSource: UrlArtifactSource;

  private readonly updateLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly config: AppConfig,
    private readonly repository: PreviewRepository,
    private readonly store: ObjectStore,
  ) {
    this.importer = new ArchiveImporter(store, {
      maxCompressedBytes: config.maxCompressedBytes,
      maxExtractedBytes: config.maxExtractedBytes,
      maxFileCount: config.maxFileCount,
      maxPathLength: config.maxPathLength,
    });
    this.publisher = new PreviewPublisher(store);
    this.urlSource = new UrlArtifactSource(config);
  }

  async createFromFile(input: { ownerUserId: string; archivePath: string; lifetimeMinutes?: number; displayName?: string | null }): Promise<Preview> {
    return withImportPermit(input.ownerUserId, this.config.maxConcurrentImportsPerUser, () =>
      this.createFromArtifact({ ...input, sourceType: 'UPLOAD' }));
  }

  async createFromUrl(input: { ownerUserId: string; sourceUrl: string; lifetimeMinutes?: number; displayName?: string | null }): Promise<Preview> {
    return withImportPermit(input.ownerUserId, this.config.maxConcurrentImportsPerUser, async () => {
      await this.assertActivePreviewCapacity(input.ownerUserId);
      const fetched = await this.urlSource.fetch(input.sourceUrl);
      try {
        return await this.createFromArtifact({
          ownerUserId: input.ownerUserId,
          archivePath: fetched.archivePath,
          sourceType: 'URL',
          ...(input.lifetimeMinutes !== undefined ? { lifetimeMinutes: input.lifetimeMinutes } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        });
      } finally {
        await fetched.cleanup().catch(() => undefined);
      }
    });
  }

  private async createFromArtifact(input: { ownerUserId: string; archivePath: string; lifetimeMinutes?: number; displayName?: string | null; sourceType: 'UPLOAD' | 'URL' }): Promise<Preview> {
    const lifetime = input.lifetimeMinutes ?? this.config.ttlDefaultMinutes;
    if (!Number.isInteger(lifetime) || lifetime < this.config.ttlMinMinutes || lifetime > this.config.ttlMaxMinutes) throw new ApplicationError('INVALID_TTL');
    const id = createPreviewId();
    const hostname = `${id}.${this.config.previewDomainSuffix}`;
    const expiresAt = new Date(Date.now() + lifetime * 60_000);
    await withCreateLock(input.ownerUserId, async () => {
      await this.assertActivePreviewCapacity(input.ownerUserId);
      await this.repository.create({ id, ownerUserId: input.ownerUserId, hostname, expiresAt, sourceType: input.sourceType, displayName: input.displayName ?? null });
    });
    let stagingKey: Awaited<ReturnType<ArchiveImporter['importFromFile']>>['stagingKey'] | undefined;
    try {
      const imported = await this.importer.importFromFile(input.archivePath);
      stagingKey = imported.stagingKey;
      const digest = await sha256File(input.archivePath);
      return await withStorageQuotaLock(async () => {
        await this.assertStorageCapacity(input.ownerUserId, imported.artifact.extractedSizeBytes, 0);
        const replacement = await this.publisher.prepareReplacement(id, stagingKey!);
        try {
          const ready = await this.repository.markReadyFromCreating(id, {
            compressedSizeBytes: imported.artifact.compressedSizeBytes,
            extractedSizeBytes: imported.artifact.extractedSizeBytes,
            fileCount: imported.artifact.fileCount,
            sourceSha256: digest,
          });
          if (!ready) throw new ApplicationError('PREVIEW_STATE_CHANGED');
          await replacement.commit();
          return ready;
        } catch (error) {
          await replacement.rollback().catch(() => undefined);
          throw error;
        }
      });
    } catch (error) {
      await this.repository.markFailedFromCreating(id, error instanceof Error ? error.message.slice(0, 120) : 'IMPORT_FAILED').catch(() => undefined);
      throw error;
    } finally {
      if (stagingKey) await this.store.deleteStagingArea(stagingKey).catch(() => undefined);
    }
  }

  async updateFromFile(input: { ownerUserId: string; previewId: string; archivePath: string }): Promise<Preview | null> {
    return withImportPermit(input.ownerUserId, this.config.maxConcurrentImportsPerUser, () =>
      this.withUpdateLock(input.previewId, () => this.updateFromArtifact({ ...input, sourceType: 'UPLOAD' })));
  }

  async updateFromUrl(input: { ownerUserId: string; previewId: string; sourceUrl: string }): Promise<Preview | null> {
    return withImportPermit(input.ownerUserId, this.config.maxConcurrentImportsPerUser, async () => {
      const fetched = await this.urlSource.fetch(input.sourceUrl);
      try {
        return await this.withUpdateLock(input.previewId, () => this.updateFromArtifact({ ownerUserId: input.ownerUserId, previewId: input.previewId, archivePath: fetched.archivePath, sourceType: 'URL' }));
      } finally {
        await fetched.cleanup().catch(() => undefined);
      }
    });
  }

  private async updateFromArtifact(input: { ownerUserId: string; previewId: string; archivePath: string; sourceType: 'UPLOAD' | 'URL' }): Promise<Preview | null> {
    const current = await this.repository.findOwnedById(input.ownerUserId, input.previewId);
    if (!current || current.status !== 'READY') return null;
    let stagingKey: StagingKey | undefined;
    try {
      const imported = await this.importer.importFromFile(input.archivePath);
      stagingKey = imported.stagingKey;
      const digest = await sha256File(input.archivePath);
      return await withStorageQuotaLock(async () => {
        await this.assertStorageCapacity(input.ownerUserId, imported.artifact.extractedSizeBytes, current.extractedSizeBytes ?? 0);
        const replacement = await this.publisher.prepareReplacement(input.previewId, stagingKey!);
        try {
          const updated = await this.repository.markUpdatedOwned(input.ownerUserId, input.previewId, {
            compressedSizeBytes: imported.artifact.compressedSizeBytes,
            extractedSizeBytes: imported.artifact.extractedSizeBytes,
            fileCount: imported.artifact.fileCount,
            sourceSha256: digest,
            sourceType: input.sourceType,
          });
          if (!updated) {
            await replacement.rollback();
            return null;
          }
          await replacement.commit();
          return updated;
        } catch (error) {
          await replacement.rollback().catch(() => undefined);
          throw error;
        }
      });
    } finally {
      if (stagingKey) await this.store.deleteStagingArea(stagingKey).catch(() => undefined);
    }
  }

  private async withUpdateLock<T>(previewId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.updateLocks.get(previewId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const chain = previous.then(() => gate);
    this.updateLocks.set(previewId, chain);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.updateLocks.get(previewId) === chain) this.updateLocks.delete(previewId);
    }
  }

  private async assertActivePreviewCapacity(ownerUserId: string): Promise<void> {
    const count = await this.repository.countActiveOwned(ownerUserId);
    if (count >= this.config.maxActivePreviewsPerUser) throw new ApplicationError('ACTIVE_PREVIEW_LIMIT');
  }

  private async assertStorageCapacity(ownerUserId: string, incomingBytes: number, replacedBytes: number): Promise<void> {
    const delta = Math.max(0, incomingBytes - replacedBytes);
    if (delta === 0) return;
    const [ownedBytes, totalBytes] = await Promise.all([
      this.repository.sumReadyExtractedBytesOwned(ownerUserId),
      this.repository.sumReadyExtractedBytesTotal(),
    ]);
    if (ownedBytes + delta > this.config.maxStorageBytesPerUser) throw new ApplicationError('USER_STORAGE_QUOTA_LIMIT');
    if (totalBytes + delta > this.config.maxStorageBytesTotal) throw new ApplicationError('TOTAL_STORAGE_QUOTA_LIMIT');
  }

  async listOwned(ownerUserId: string): Promise<Preview[]> {
    return this.repository.listOwned(ownerUserId);
  }

  async getOwned(ownerUserId: string, previewId: string): Promise<Preview | null> {
    const preview = await this.repository.findOwnedById(ownerUserId, previewId);
    if (!preview || preview.status === 'DELETED') return null;
    return preview;
  }

  async extendOwned(ownerUserId: string, previewId: string, lifetimeMinutes: number): Promise<Preview | null> {
    if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes < this.config.ttlMinMinutes || lifetimeMinutes > this.config.ttlMaxMinutes) {
      throw new ApplicationError('INVALID_TTL');
    }
    const current = await this.repository.findOwnedById(ownerUserId, previewId);
    if (!current || ['DELETED','DELETING','EXPIRED'].includes(current.status)) return null;
    const expiresAt = new Date(Date.now() + lifetimeMinutes * 60_000);
    if (expiresAt <= current.expiresAt) throw new ApplicationError('INVALID_EXTENSION');
    return this.repository.extendOwned(ownerUserId, previewId, expiresAt);
  }

  async deleteOwned(ownerUserId: string, previewId: string): Promise<boolean> {
    const preview = await this.repository.markDeletingOwned(ownerUserId, previewId);
    if (!preview) {
      const existing = await this.repository.findOwnedById(ownerUserId, previewId);
      return existing?.status === 'DELETED';
    }
    await this.store.deletePreviewArea(previewStorageKey(previewId));
    await this.repository.markDeletedOwnedFromDeleting(ownerUserId, previewId);
    return true;
  }

}

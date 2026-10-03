import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ObjectStore, PreviewReplacement } from './object-store.js';
import { createStagingKey, type PreviewStorageKey, type StagingKey } from './storage-key.js';

function assertSafeDataRoot(dataRoot: string): string {
  const resolved = path.resolve(dataRoot);
  if (resolved === path.parse(resolved).root) throw new Error('DATA_ROOT must not be a filesystem root');
  return resolved;
}

export class LocalVolumeObjectStore implements ObjectStore {
  readonly dataRoot: string;
  readonly previewsRoot: string;
  readonly stagingRoot: string;
  readonly tmpRoot: string;

  constructor(dataRoot: string) {
    this.dataRoot = assertSafeDataRoot(dataRoot);
    this.previewsRoot = path.join(this.dataRoot, 'previews');
    this.stagingRoot = path.join(this.dataRoot, 'staging');
    this.tmpRoot = path.join(this.dataRoot, 'tmp');
  }

  async initialize(): Promise<void> {
    await Promise.all([mkdir(this.previewsRoot,{recursive:true}),mkdir(this.stagingRoot,{recursive:true}),mkdir(this.tmpRoot,{recursive:true})]);
  }

  async createStagingArea(): Promise<StagingKey> {
    const key = createStagingKey();
    await mkdir(this.getStagingSiteRoot(key), { recursive: true });
    return key;
  }
  async deleteStagingArea(key: StagingKey): Promise<void> { await rm(this.stagingAreaRoot(key), { recursive: true, force: true }); }
  async createPreviewArea(key: PreviewStorageKey): Promise<void> { await mkdir(this.getPreviewSiteRoot(key), { recursive: true }); }
  async deletePreviewArea(key: PreviewStorageKey): Promise<void> { await rm(this.previewAreaRoot(key), { recursive: true, force: true }); }
  getStagingSiteRoot(key: StagingKey): string { return path.join(this.stagingAreaRoot(key), 'site'); }
  getPreviewSiteRoot(key: PreviewStorageKey): string { return path.join(this.previewAreaRoot(key), 'current'); }

  async replacePreviewSite(key: PreviewStorageKey, sourceDir: string): Promise<PreviewReplacement> {
    const area = this.previewAreaRoot(key);
    await mkdir(area, { recursive: true });
    const token = randomBytes(12).toString('hex');
    const incoming = path.join(area, `.incoming-${token}`);
    const backup = path.join(area, `.backup-${token}`);
    const current = this.getPreviewSiteRoot(key);
    await cp(sourceDir, incoming, { recursive: true, force: false, errorOnExist: false });

    let hadCurrent = false;
    try {
      await rename(current, backup);
      hadCurrent = true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') { await rm(incoming,{recursive:true,force:true}); throw error; }
    }
    try {
      await rename(incoming, current);
    } catch (error) {
      if (hadCurrent) await rename(backup, current).catch(() => undefined);
      await rm(incoming,{recursive:true,force:true}).catch(() => undefined);
      throw error;
    }

    let finished = false;
    return {
      commit: async () => {
        if (finished) return;
        finished = true;
        await rm(backup, { recursive: true, force: true });
      },
      rollback: async () => {
        if (finished) return;
        finished = true;
        await rm(current, { recursive: true, force: true });
        if (hadCurrent) await rename(backup, current);
        else await rm(backup, { recursive: true, force: true });
      },
    };
  }


  async listPreviewKeys(): Promise<string[]> {
    await this.initialize();
    const entries = await readdir(this.previewsRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^p-[a-f0-9]{32}$/.test(entry.name)).map((entry) => entry.name);
  }

  async deleteStagingOlderThan(before: Date): Promise<number> {
    await this.initialize();
    const entries = await readdir(this.stagingRoot, { withFileTypes: true });
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^s-[a-f0-9]{32}$/.test(entry.name)) continue;
      const root = path.join(this.stagingRoot, entry.name);
      const info = await stat(root);
      if (info.mtime < before) { await rm(root, { recursive: true, force: true }); deleted += 1; }
    }
    return deleted;
  }

  private stagingAreaRoot(key: StagingKey): string { return this.scopedPath(this.stagingRoot, key); }
  private previewAreaRoot(key: PreviewStorageKey): string { return this.scopedPath(this.previewsRoot, key); }
  private scopedPath(root: string, key: string): string {
    const resolved = path.resolve(root, key);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Storage key escaped configured root');
    return resolved;
  }
}

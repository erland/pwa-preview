import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';
import { createPreviewStorageKey } from '../../src/storage/storage-key.js';

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pwa-preview-storage-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalVolumeObjectStore', () => {
  it('creates isolated staging and preview roots below DATA_ROOT', async () => {
    const root = await tempRoot();
    const store = new LocalVolumeObjectStore(root);
    await store.initialize();

    const staging = await store.createStagingArea();
    const preview = createPreviewStorageKey();
    await store.createPreviewArea(preview);

    expect(store.getStagingSiteRoot(staging).startsWith(path.join(root, 'staging') + path.sep)).toBe(true);
    expect(store.getPreviewSiteRoot(preview).startsWith(path.join(root, 'previews') + path.sep)).toBe(true);
  });

  it('deletes only the selected staging area', async () => {
    const root = await tempRoot();
    const store = new LocalVolumeObjectStore(root);
    await store.initialize();
    const first = await store.createStagingArea();
    const second = await store.createStagingArea();
    await writeFile(path.join(store.getStagingSiteRoot(second), 'keep.txt'), 'keep');

    await store.deleteStagingArea(first);

    await expect(readFile(path.join(store.getStagingSiteRoot(second), 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });

  it('refuses filesystem root as DATA_ROOT', () => {
    expect(() => new LocalVolumeObjectStore(path.parse(process.cwd()).root)).toThrow(/must not be a filesystem root/);
  });
});

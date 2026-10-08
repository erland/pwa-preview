import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';
import { exportPreviewZip } from '../../src/preview/preview-zip-export.js';
import { ArchiveImporter } from '../../src/artifact/archive-importer.js';
import { LocalVolumeObjectStore } from '../../src/storage/local-volume-object-store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'preview-zip-test-'));
  roots.push(dir);
  return dir;
}

async function archiveEntries(buffer: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('ZIP_OPEN_FAILED'));
      const names: string[] = [];
      zip.on('entry', (entry) => { names.push(entry.fileName); zip.readEntry(); });
      zip.on('error', reject);
      zip.on('end', () => resolve(names));
      zip.readEntry();
    });
  });
}

it('exports the deployed site with index.html at the ZIP root and nested assets intact', async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<h1>Preview</h1>');
  await writeFile(path.join(root, 'assets', 'main.js'), 'console.log("ok")');
  const zip = await exportPreviewZip(root);
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  expect(await archiveEntries(Buffer.concat(chunks))).toEqual(['assets/main.js', 'index.html']);
});

it('rejects symlinks rather than exporting files outside the published site', async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, 'index.html'), 'ok');
  await symlink(path.join(root, 'index.html'), path.join(root, 'linked.html'));
  await expect(exportPreviewZip(root)).rejects.toThrow('UNSAFE_PREVIEW_EXPORT_ENTRY');
});

it('re-imports the exported ZIP through the production archive importer', async () => {
  const root = await makeRoot();
  const site = path.join(root, 'published');
  await mkdir(path.join(site, 'assets'), { recursive: true });
  await writeFile(path.join(site, 'index.html'), '<!doctype html><script src="/assets/app.js"></script>');
  await writeFile(path.join(site, 'assets', 'app.js'), 'console.log("roundtrip")');
  const exported = await exportPreviewZip(site);
  const chunks: Buffer[] = [];
  for await (const chunk of exported.outputStream) chunks.push(Buffer.from(chunk));
  const zipPath = path.join(root, 'downloaded.zip');
  await writeFile(zipPath, Buffer.concat(chunks));

  const store = new LocalVolumeObjectStore(path.join(root, 'storage'));
  await store.initialize();
  const importer = new ArchiveImporter(store, {
    maxCompressedBytes: 100 * 1024 * 1024,
    maxExtractedBytes: 500 * 1024 * 1024,
    maxFileCount: 20_000,
    maxPathLength: 1024,
  });
  const imported = await importer.importFromFile(zipPath);
  try {
    expect(await readFile(path.join(imported.artifact.siteRoot, 'index.html'), 'utf8'))
      .toBe('<!doctype html><script src="/assets/app.js"></script>');
    expect(await readFile(path.join(imported.artifact.siteRoot, 'assets', 'app.js'), 'utf8'))
      .toBe('console.log("roundtrip")');
    expect(imported.artifact.fileCount).toBe(2);
  } finally {
    await store.deleteStagingArea(imported.stagingKey);
  }
});

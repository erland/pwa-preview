import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';
import { exportPreviewZip } from '../../src/preview/preview-zip-export.js';

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

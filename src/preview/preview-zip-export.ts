import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import yazl from 'yazl';

/** Produce a ZIP with site files at its root, suitable for ArchiveImporter. */
export async function exportPreviewZip(siteRoot: string): Promise<yazl.ZipFile> {
  const zip = new yazl.ZipFile();
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        throw new Error('UNSAFE_PREVIEW_EXPORT_ENTRY');
      }
      if (info.isDirectory()) await walk(absolute, relative);
      else zip.addFile(absolute, relative, { compress: true });
    }
  };
  try {
    await walk(siteRoot, '');
    zip.end();
    return zip;
  } catch (error) {
    zip.end();
    throw error;
  }
}

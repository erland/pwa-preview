import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

async function hasIndex(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, 'index.html'))).isFile();
  } catch {
    return false;
  }
}

export async function detectSiteRoot(extractedRoot: string): Promise<string> {
  if (await hasIndex(extractedRoot)) return extractedRoot;

  const entries = (await readdir(extractedRoot, { withFileTypes: true })).filter((e) => e.name !== '__MACOSX');
  if (entries.length === 1 && entries[0]!.isDirectory()) {
    const nested = path.join(extractedRoot, entries[0]!.name);
    if (await hasIndex(nested)) return nested;
  }
  throw new Error('Artifact must contain index.html at archive root or in one top-level directory');
}

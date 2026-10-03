import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar-stream';
import yauzl from 'yauzl';
import { normalizeArchivePath, safeDestination } from './archive-path.js';
import type { ArchiveFormat, ArtifactLimits } from './types.js';

type Counters = { bytes: number; files: number };

function countFile(counters: Counters, size: number, limits: ArtifactLimits): void {
  counters.files += 1;
  if (counters.files > limits.maxFileCount) throw new Error('Archive contains too many files');
  counters.bytes += size;
  if (counters.bytes > limits.maxExtractedBytes) throw new Error('Archive extracted size exceeds limit');
}

async function extractZip(archivePath: string, destinationRoot: string, limits: ArtifactLimits): Promise<Counters> {
  const counters: Counters = { bytes: 0, files: 0 };
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: false }, (error, file) => error || !file ? reject(error ?? new Error('Cannot open ZIP')) : resolve(file));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let busy = false;
      const fail = (e: unknown) => reject(e instanceof Error ? e : new Error(String(e)));
      zip.on('error', fail);
      zip.on('end', () => { if (!busy) resolve(); });
      zip.on('entry', (entry) => {
        busy = true;
        void (async () => {
          const relative = normalizeArchivePath(entry.fileName, limits.maxPathLength);
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const fileType = unixMode & 0o170000;
          if (fileType === 0o120000) throw new Error('Symlinks are not allowed in ZIP archives');
          if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) throw new Error('Special files are not allowed in ZIP archives');
          const isDirectory = entry.fileName.endsWith('/') || fileType === 0o040000;
          if (relative === '') { busy = false; zip.readEntry(); return; }
          const destination = safeDestination(destinationRoot, relative);
          if (isDirectory) {
            await mkdir(destination, { recursive: true });
          } else {
            countFile(counters, entry.uncompressedSize, limits);
            await mkdir(path.dirname(destination), { recursive: true });
            const input = await new Promise<Readable>((resolveStream, rejectStream) => {
              zip.openReadStream(entry, (error, stream) => error || !stream ? rejectStream(error ?? new Error('Cannot read ZIP entry')) : resolveStream(stream));
            });
            let actual = 0;
            input.on('data', (chunk: unknown) => {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
              actual += bytes.length;
              if (counters.bytes - entry.uncompressedSize + actual > limits.maxExtractedBytes) input.destroy(new Error('Archive extracted size exceeds limit'));
            });
            await pipeline(input, createWriteStream(destination, { flags: 'wx', mode: 0o644 }));
          }
          busy = false;
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return counters;
}

async function extractTarGz(archivePath: string, destinationRoot: string, limits: ArtifactLimits): Promise<Counters> {
  const counters: Counters = { bytes: 0, files: 0 };
  const extractor = tar.extract();
  extractor.on('entry', (header, stream, next) => {
    void (async () => {
      const relative = normalizeArchivePath(header.name, limits.maxPathLength);
      if (['symlink', 'link', 'character-device', 'block-device', 'fifo', 'contiguous-file'].includes(header.type ?? '')) {
        throw new Error('Links and special files are not allowed in tar archives');
      }
      if (relative === '') { stream.resume(); stream.once('end', next); return; }
      const destination = safeDestination(destinationRoot, relative);
      if (header.type === 'directory') {
        await mkdir(destination, { recursive: true });
        stream.resume(); stream.once('end', next);
        return;
      }
      if (header.type !== 'file' && header.type !== undefined) throw new Error('Unsupported tar entry type');
      countFile(counters, header.size ?? 0, limits);
      await mkdir(path.dirname(destination), { recursive: true });
      let actual = 0;
      stream.on('data', (chunk: unknown) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        actual += bytes.length;
        if (counters.bytes - (header.size ?? 0) + actual > limits.maxExtractedBytes) stream.destroy(new Error('Archive extracted size exceeds limit'));
      });
      await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o644 }));
      next();
    })().catch((error) => extractor.destroy(error instanceof Error ? error : new Error(String(error))));
  });
  await pipeline(createReadStream(archivePath), createGunzip(), extractor);
  return counters;
}

export async function safeExtractArchive(archivePath: string, format: ArchiveFormat, destinationRoot: string, limits: ArtifactLimits): Promise<Counters> {
  const compressed = (await stat(archivePath)).size;
  if (compressed > limits.maxCompressedBytes) throw new Error('Compressed artifact size exceeds limit');
  await mkdir(destinationRoot, { recursive: true });
  return format === 'zip'
    ? extractZip(archivePath, destinationRoot, limits)
    : extractTarGz(archivePath, destinationRoot, limits);
}

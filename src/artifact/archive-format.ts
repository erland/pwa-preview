import { open } from 'node:fs/promises';
import type { ArchiveFormat } from './types.js';

export async function detectArchiveFormat(filePath: string): Promise<ArchiveFormat> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return 'tar.gz';
    if (bytesRead >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]!) && [0x04, 0x06, 0x08].includes(buffer[3]!)) return 'zip';
    throw new Error('Unsupported archive format');
  } finally {
    await handle.close();
  }
}

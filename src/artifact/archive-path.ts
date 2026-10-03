import path from 'node:path';

export function normalizeArchivePath(raw: string, maxPathLength: number): string {
  if (!raw || raw.includes('\0')) throw new Error('Archive entry has invalid path');
  const unix = raw.replaceAll('\\', '/');
  if (unix.length > maxPathLength) throw new Error('Archive entry path exceeds limit');
  if (unix.startsWith('/') || /^[A-Za-z]:\//.test(unix)) throw new Error('Absolute archive paths are not allowed');
  const parts = unix.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.some((part) => part === '..')) throw new Error('Archive path traversal is not allowed');
  if (parts.length === 0) return '';
  return parts.join('/');
}

export function safeDestination(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return resolved;
  throw new Error('Archive entry escaped staging root');
}

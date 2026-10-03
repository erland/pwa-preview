import { randomBytes } from 'node:crypto';

export function createPreviewId(): string {
  return `p-${randomBytes(16).toString('hex')}`;
}

export function isPreviewId(value: string): boolean {
  return /^p-[a-f0-9]{32}$/.test(value);
}

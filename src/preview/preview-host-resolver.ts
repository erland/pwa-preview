import { isPreviewId } from './preview-id.js';

export function resolvePreviewIdFromHost(hostHeader: string | undefined, suffix: string): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(':', 1)[0]!.toLowerCase();
  const ending = `.${suffix.toLowerCase()}`;
  if (!host.endsWith(ending)) return null;
  const id = host.slice(0, -ending.length);
  return isPreviewId(id) ? id : null;
}

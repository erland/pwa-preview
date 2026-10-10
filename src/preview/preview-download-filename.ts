/**
 * Generate a readable, safe ZIP filename. The ASCII fallback works in older clients;
 * filename* preserves Swedish and other Unicode characters in modern browsers.
 */
export function previewDownloadDisposition(name: string | null, previewId: string): string {
  const cleaned = (name ?? '')
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f\/\\<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 120)
    .trim();
  const base = cleaned || previewId;
  const ascii = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '') || previewId;
  const encoded = encodeURIComponent(base + '.zip').replace(/['()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encoded}`;
}

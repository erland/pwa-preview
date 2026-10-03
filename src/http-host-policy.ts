export type RequestPlane = 'CONTROL' | 'PREVIEW' | 'UNKNOWN';

function normalizedHost(rawHost: string | undefined): string {
  if (!rawHost) return '';
  const value = rawHost.trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end >= 0 ? value.slice(0, end + 1) : value;
  }
  return value.replace(/:\d+$/, '');
}

export function classifyRequestPlane(rawHost: string | undefined, controlPlaneHost: string, previewDomainSuffix: string): RequestPlane {
  const host = normalizedHost(rawHost);
  if (host === controlPlaneHost) return 'CONTROL';
  if (host.endsWith(`.${previewDomainSuffix}`)) return 'PREVIEW';
  return 'UNKNOWN';
}

import dns from 'node:dns/promises';
import net from 'node:net';

export type DnsResolver = (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export function isBlockedIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const p = address.split('.').map(Number);
    const a = p[0]!;
    const b = p[1]!;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (family === 6) {
    const v = address.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fc') || v.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(v)) return true;
    if (v.startsWith('ff')) return true;
    if (v.startsWith('::ffff:')) {
      const mapped = v.slice('::ffff:'.length);
      return net.isIPv4(mapped) ? isBlockedIp(mapped) : true;
    }
  }
  return family === 0;
}

export class SsrfPolicy {
  constructor(private readonly resolver: DnsResolver = async (hostname) => {
    const rows = await dns.lookup(hostname, { all: true, verbatim: true });
    return rows.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  }) {}

  async validateAndResolve(rawUrl: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error('INVALID_SOURCE_URL'); }
    if (url.protocol !== 'https:') throw new Error('SOURCE_URL_HTTPS_REQUIRED');
    if (url.username || url.password) throw new Error('SOURCE_URL_CREDENTIALS_FORBIDDEN');
    if (url.port && url.port !== '443') throw new Error('SOURCE_URL_PORT_FORBIDDEN');
    if (!url.hostname) throw new Error('INVALID_SOURCE_URL');

    const literalFamily = net.isIP(url.hostname);
    const resolved = literalFamily
      ? [{ address: url.hostname, family: literalFamily as 4 | 6 }]
      : await this.resolver(url.hostname);
    if (resolved.length === 0) throw new Error('SOURCE_URL_DNS_FAILED');
    if (resolved.some((r) => isBlockedIp(r.address))) throw new Error('SOURCE_URL_TARGET_FORBIDDEN');
    const first = resolved[0]!;
    return { url, address: first.address, family: first.family };
  }
}

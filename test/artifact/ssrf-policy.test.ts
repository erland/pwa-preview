import { describe, expect, it } from 'vitest';
import { isBlockedIp, SsrfPolicy } from '../../src/artifact/ssrf-policy.js';

describe('SSRF policy', () => {
  it.each(['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','::1','fc00::1','fe80::1'])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])('allows public %s', (ip) => expect(isBlockedIp(ip)).toBe(false));
  it('requires HTTPS and rejects credentials', async () => {
    const p = new SsrfPolicy(async () => [{ address:'1.1.1.1', family:4 }]);
    await expect(p.validateAndResolve('http://example.com/a.zip')).rejects.toThrow('SOURCE_URL_HTTPS_REQUIRED');
    await expect(p.validateAndResolve('https://u:p@example.com/a.zip')).rejects.toThrow('SOURCE_URL_CREDENTIALS_FORBIDDEN');
  });
  it('rejects a hostname if any resolved address is private', async () => {
    const p = new SsrfPolicy(async () => [{ address:'1.1.1.1', family:4 }, { address:'10.0.0.1', family:4 }]);
    await expect(p.validateAndResolve('https://example.com/a.zip')).rejects.toThrow('SOURCE_URL_TARGET_FORBIDDEN');
  });
});

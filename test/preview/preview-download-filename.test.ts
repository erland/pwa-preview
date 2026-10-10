import { describe, expect, it } from 'vitest';
import { previewDownloadDisposition } from '../../src/preview/preview-download-filename.js';

describe('preview ZIP download names', () => {
  it('uses the name and preserves Swedish characters', () => {
    expect(previewDownloadDisposition('Min häftiga prototyp', 'p-abcdef1234567890'))
      .toBe('attachment; filename="Min-haftiga-prototyp.zip"; filename*=UTF-8\'\'Min%20h%C3%A4ftiga%20prototyp.zip');
  });
  it('falls back to the preview ID when no name is present', () => {
    expect(previewDownloadDisposition(null, 'p-abcdef1234567890')).toContain('filename="p-abcdef1234567890.zip"');
  });
  it('does not allow header injection or unsafe path characters', () => {
    const value = previewDownloadDisposition('name\r\nHeader: bad/../../evil', 'p-abcdef1234567890');
    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
    expect(value).not.toContain('../');
    expect(value).not.toContain('Header:');
  });
});

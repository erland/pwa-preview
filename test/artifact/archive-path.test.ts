import { describe, expect, it } from 'vitest';
import { normalizeArchivePath } from '../../src/artifact/archive-path.js';

describe('archive path validation', () => {
  it.each(['../evil.txt','a/../../evil','/etc/passwd','C:/evil','a\\..\\evil'])('rejects unsafe path %s', (value) => {
    expect(() => normalizeArchivePath(value, 1024)).toThrow();
  });
  it('normalizes a safe path', () => expect(normalizeArchivePath('./assets/app.js', 1024)).toBe('assets/app.js'));
  it('enforces path length', () => expect(() => normalizeArchivePath('a'.repeat(20), 10)).toThrow(/path exceeds/));
});

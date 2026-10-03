import { describe, expect, it } from 'vitest';
import {
  createPreviewStorageKey,
  createStagingKey,
  previewStorageKey,
  stagingKey,
} from '../../src/storage/storage-key.js';

describe('storage keys', () => {
  it('generates opaque server-side keys with at least 128 random bits', () => {
    expect(createStagingKey()).toMatch(/^s-[0-9a-f]{32}$/);
    expect(createPreviewStorageKey()).toMatch(/^p-[0-9a-f]{32}$/);
  });

  it.each(['../escape', '/absolute', 'a/b', '..', 'A-UPPER', ''])('rejects unsafe key %j', (value) => {
    expect(() => stagingKey(value)).toThrow();
    expect(() => previewStorageKey(value)).toThrow();
  });
});

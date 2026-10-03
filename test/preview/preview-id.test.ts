import { describe, expect, it } from 'vitest';
import { createPreviewId, isPreviewId } from '../../src/preview/preview-id.js';
import { resolvePreviewIdFromHost } from '../../src/preview/preview-host-resolver.js';

describe('preview ids and hosts', () => {
  it('generates DNS-safe 128-bit identifiers', () => {
    const id = createPreviewId();
    expect(id).toMatch(/^p-[a-f0-9]{32}$/);
    expect(isPreviewId(id)).toBe(true);
  });

  it('resolves only valid wildcard hosts', () => {
    const id = createPreviewId();
    expect(resolvePreviewIdFromHost(`${id}.previewapp.apphome.one`, 'previewapp.apphome.one')).toBe(id);
    expect(resolvePreviewIdFromHost(`evil.${id}.previewapp.apphome.one`, 'previewapp.apphome.one')).toBeNull();
    expect(resolvePreviewIdFromHost('p-bad.previewapp.apphome.one', 'previewapp.apphome.one')).toBeNull();
  });
});

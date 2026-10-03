import { describe, expect, it } from 'vitest';
import { classifyRequestPlane } from '../src/http-host-policy.js';

describe('request host policy', () => {
  const control = 'pwa-preview.apps.isaksson.info';
  const preview = 'previewapp.apphome.one';

  it('accepts only the configured control host as control plane', () => {
    expect(classifyRequestPlane(control, control, preview)).toBe('CONTROL');
    expect(classifyRequestPlane(`${control}:443`, control, preview)).toBe('CONTROL');
    expect(classifyRequestPlane(`evil.${control}`, control, preview)).toBe('UNKNOWN');
  });

  it('classifies any subdomain below preview suffix as preview plane', () => {
    expect(classifyRequestPlane('p-0123456789abcdef0123456789abcdef.previewapp.apphome.one', control, preview)).toBe('PREVIEW');
    expect(classifyRequestPlane('invalid.previewapp.apphome.one', control, preview)).toBe('PREVIEW');
    expect(classifyRequestPlane(preview, control, preview)).toBe('UNKNOWN');
  });

  it('rejects unrelated hosts', () => {
    expect(classifyRequestPlane('example.com', control, preview)).toBe('UNKNOWN');
    expect(classifyRequestPlane(undefined, control, preview)).toBe('UNKNOWN');
  });
});

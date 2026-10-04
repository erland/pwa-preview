import { describe, expect, it } from 'vitest';
import { createUrlInputSchema, extendInputSchema, normalizePreviewName, previewIdSchema, previewNameSchema, sourceUrlSchema } from '../../src/preview/preview-input.js';
import { ApplicationError } from '../../src/errors/application-error.js';

const config = { ttlMinMinutes: 5, ttlMaxMinutes: 60 };

describe('preview input validation', () => {
  it('uses one preview id rule', () => {
    expect(previewIdSchema.safeParse('p-' + 'a'.repeat(32)).success).toBe(true);
    expect(previewIdSchema.safeParse('preview-123').success).toBe(false);
  });

  it('requires HTTPS artifact URLs', () => {
    expect(sourceUrlSchema.safeParse('https://example.com/app.zip').success).toBe(true);
    expect(sourceUrlSchema.safeParse('http://example.com/app.zip').success).toBe(false);
    expect(sourceUrlSchema.safeParse('not a url').success).toBe(false);
  });

  it('normalizes names and enforces the 200 character limit', () => {
    expect(previewNameSchema.parse('  Demo  ')).toBe('Demo');
    expect(() => normalizePreviewName('   ')).toThrow(ApplicationError);
    expect(() => normalizePreviewName('x'.repeat(201))).toThrow('INVALID_PREVIEW_NAME');
  });

  it('uses configured TTL bounds for create and extend', () => {
    expect(createUrlInputSchema(config).safeParse({ sourceUrl:'https://example.com/app.zip', lifetimeMinutes:5 }).success).toBe(true);
    expect(createUrlInputSchema(config).safeParse({ sourceUrl:'https://example.com/app.zip', lifetimeMinutes:4 }).success).toBe(false);
    expect(extendInputSchema(config).safeParse({ previewId:'p-' + 'b'.repeat(32), lifetimeMinutes:61 }).success).toBe(false);
  });
});

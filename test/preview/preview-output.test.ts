import { describe, expect, it } from 'vitest';
import type { Preview } from '../../src/domain/models.js';
import { toPreviewOutput } from '../../src/preview/preview-output.js';

describe('toPreviewOutput', () => {
  it('maps the preview domain model to the shared transport contract', () => {
    const preview: Preview = {
      id: 'p-' + 'a'.repeat(32),
      ownerUserId: 'owner-a',
      displayName: 'Demo',
      status: 'READY',
      hostname: `p-${'a'.repeat(32)}.preview.example`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:05:00.000Z'),
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
      compressedSizeBytes: 10,
      extractedSizeBytes: 20,
      fileCount: 2,
      sourceSha256: 'b'.repeat(64),
      sourceType: 'UPLOAD',
      lastErrorCode: null, publicationMode:'TEMPORARY', slug:null,
    };

    expect(toPreviewOutput(preview)).toEqual({
      previewId: preview.id,
      url: `https://${preview.hostname}`,
      name: 'Demo',
      status: 'READY',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:05:00.000Z',
      expiresAt: '2026-01-01T01:00:00.000Z',
      compressedSizeBytes: 10,
      extractedSizeBytes: 20,
      fileCount: 2,
      sourceSha256: 'b'.repeat(64),
      sourceType: 'UPLOAD',
      publicationMode:'TEMPORARY', slug:null,
    });
  });
});

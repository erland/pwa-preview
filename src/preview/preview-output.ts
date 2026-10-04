import type { Preview } from '../domain/models.js';

export type PreviewOutput = {
  previewId: string;
  url: string;
  name: string | null;
  status: Preview['status'];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  compressedSizeBytes: number | null;
  extractedSizeBytes: number | null;
  fileCount: number | null;
  sourceSha256: string | null;
  sourceType: Preview['sourceType'];
};

export function toPreviewOutput(preview: Preview): PreviewOutput {
  return {
    previewId: preview.id,
    url: `https://${preview.hostname}`,
    name: preview.displayName,
    status: preview.status,
    createdAt: preview.createdAt.toISOString(),
    updatedAt: preview.updatedAt.toISOString(),
    expiresAt: preview.expiresAt.toISOString(),
    compressedSizeBytes: preview.compressedSizeBytes,
    extractedSizeBytes: preview.extractedSizeBytes,
    fileCount: preview.fileCount,
    sourceSha256: preview.sourceSha256,
    sourceType: preview.sourceType,
  };
}

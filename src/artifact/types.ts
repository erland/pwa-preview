export type ArchiveFormat = 'zip' | 'tar.gz';

export type ArtifactLimits = Readonly<{
  maxCompressedBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxPathLength: number;
}>;

export type ImportedArtifact = Readonly<{
  format: ArchiveFormat;
  siteRoot: string;
  compressedSizeBytes: number;
  extractedSizeBytes: number;
  fileCount: number;
}>;

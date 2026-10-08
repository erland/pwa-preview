export type IdentityProvider = string;
export type PreviewStatus = 'CREATING' | 'READY' | 'FAILED' | 'DELETING' | 'DELETED' | 'EXPIRED';
export type PreviewSourceType = 'UPLOAD' | 'URL';

export type User = Readonly<{
  id: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}>;

export type ExternalIdentity = Readonly<{
  id: string;
  userId: string;
  provider: IdentityProvider;
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AllowlistEntry = Readonly<{
  id: string;
  provider: IdentityProvider | null;
  email: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}>;

export type Preview = Readonly<{
  id: string;
  ownerUserId: string;
  displayName: string | null;
  status: PreviewStatus;
  hostname: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  publicationMode: 'TEMPORARY' | 'PERMANENT';
  slug: string | null;
  compressedSizeBytes: number | null;
  extractedSizeBytes: number | null;
  fileCount: number | null;
  sourceSha256: string | null;
  sourceType: PreviewSourceType;
  lastErrorCode: string | null;
}>;

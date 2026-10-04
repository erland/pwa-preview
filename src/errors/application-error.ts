export type ApplicationErrorCode =
  | 'ACTIVE_PREVIEW_LIMIT'
  | 'IMPORT_CONCURRENCY_LIMIT'
  | 'INVALID_EXTENSION'
  | 'INVALID_PREVIEW_NAME'
  | 'INVALID_TTL'
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_STATE_CHANGED'
  | 'TOTAL_STORAGE_QUOTA_LIMIT'
  | 'USER_STORAGE_QUOTA_LIMIT';

export class ApplicationError extends Error {
  constructor(readonly code: ApplicationErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'ApplicationError';
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}

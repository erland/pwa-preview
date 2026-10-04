import * as z from 'zod/v4';
import type { AppConfig } from '../config.js';
import { isPreviewId } from './preview-id.js';

export const previewIdSchema = z.string().refine(isPreviewId, { message: 'INVALID_PREVIEW_ID' });

export const previewNameSchema = z.string().trim().min(1, 'INVALID_PREVIEW_NAME').max(200, 'INVALID_PREVIEW_NAME');

export const sourceUrlSchema = z.string().trim().url('INVALID_SOURCE_URL').refine((value) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, { message: 'SOURCE_URL_HTTPS_REQUIRED' });

export function lifetimeMinutesSchema(config: Pick<AppConfig, 'ttlMinMinutes' | 'ttlMaxMinutes'>) {
  return z.number().int('INVALID_TTL').min(config.ttlMinMinutes, 'INVALID_TTL').max(config.ttlMaxMinutes, 'INVALID_TTL');
}

export function createUrlInputSchema(config: Pick<AppConfig, 'ttlMinMinutes' | 'ttlMaxMinutes'>) {
  return z.object({
    sourceUrl: sourceUrlSchema,
    lifetimeMinutes: lifetimeMinutesSchema(config).optional(),
    name: previewNameSchema.optional(),
  });
}

export function updateUrlInputSchema() {
  return z.object({
    previewId: previewIdSchema,
    sourceUrl: sourceUrlSchema,
  });
}

export function extendInputSchema(config: Pick<AppConfig, 'ttlMinMinutes' | 'ttlMaxMinutes'>) {
  return z.object({
    previewId: previewIdSchema,
    lifetimeMinutes: lifetimeMinutesSchema(config),
  });
}

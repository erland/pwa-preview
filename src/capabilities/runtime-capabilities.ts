import type { AppConfig } from '../config.js';

export type RuntimeCapabilities = Readonly<{
  preview: Readonly<{
    ttlMinutes: Readonly<{
      min: number;
      default: number;
      max: number;
    }>;
    name: Readonly<{
      maxLength: number;
    }>;
    sourceUrl: Readonly<{
      requiresHttps: true;
    }>;
  }>;
  artifact: Readonly<{
    maxCompressedBytes: number;
  }>;
}>;

export function runtimeCapabilities(config: Pick<
  AppConfig,
  'ttlMinMinutes' | 'ttlDefaultMinutes' | 'ttlMaxMinutes' | 'maxCompressedBytes'
>): RuntimeCapabilities {
  return {
    preview: {
      ttlMinutes: {
        min: config.ttlMinMinutes,
        default: config.ttlDefaultMinutes,
        max: config.ttlMaxMinutes,
      },
      name: {
        maxLength: 200,
      },
      sourceUrl: {
        requiresHttps: true,
      },
    },
    artifact: {
      maxCompressedBytes: config.maxCompressedBytes,
    },
  };
}

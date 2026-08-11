import type { VideoSource } from './types.js';

export interface EmbedPolicy {
  externalOnly: boolean;
  message: string;
  webglRequired?: boolean;
}

/** Provider policies are explicit facts, never inferred from iframe onload. */
export function getEmbedPolicy(source: Pick<VideoSource, 'type' | 'url'>): EmbedPolicy | undefined {
  if (source.type !== 'website') return undefined;
  try {
    if (new URL(source.url).hostname.toLowerCase() === 'web.weatherwise.app') {
      return {
        externalOnly: true,
        webglRequired: true,
        message: 'Weatherwise does not allow embedding. Use Watch External.',
      };
    }
  } catch {
    // Source normalization reports malformed URLs elsewhere.
  }
  return undefined;
}

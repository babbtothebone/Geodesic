import type { AIProvider, GeodesicConfig } from '@geodesic/types';
import { ProviderError } from '@geodesic/types';

type ProviderFactory = (config: GeodesicConfig) => AIProvider;

// Lazy-loaded adapter map — no provider SDK is imported at module load time
async function loadFactory(name: string): Promise<{ createProvider: ProviderFactory; createEchoProvider: ProviderFactory }> {
  switch (name) {
    case 'anthropic': return import('./anthropic.js');
    case 'openai':    return import('./openai.js');
    case 'gemini':    return import('./gemini.js');
    case 'azure':     return import('./azure.js');
    case 'ollama':    return import('./ollama.js');
    case 'copilot':   return import('./copilot.js');
    default:
      throw new ProviderError(name, 'UNKNOWN', `Unknown provider: "${name}". Valid: anthropic, openai, gemini, azure, ollama, copilot`, false);
  }
}

/**
 * Loads and instantiates the primary AIProvider from the given config.
 * The correct adapter module is loaded lazily — only the configured provider's
 * SDK dependency is imported.
 */
export async function loadProvider(config: GeodesicConfig): Promise<AIProvider> {
  const mod = await loadFactory(config.provider);
  return mod.createProvider(config);
}

/**
 * Loads the Echo provider — cheapest adapter for the configured provider.
 * Used by the shadow/hint process.
 */
export async function loadEchoProvider(config: GeodesicConfig): Promise<AIProvider> {
  const mod = await loadFactory(config.provider);
  return mod.createEchoProvider(config);
}

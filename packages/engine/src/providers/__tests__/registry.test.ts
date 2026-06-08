import { describe, it, expect } from 'vitest';
import { loadProvider, loadEchoProvider } from '../registry.js';
import type { GeodesicConfig } from '@geodesic/types';
import { ProviderError } from '@geodesic/types';

const baseConfig: GeodesicConfig = {
  provider: 'anthropic',
  apiKey: 'sk-ant-test-key',
  analystId: 'test@example.com',
};

describe('loadProvider', () => {
  it('returns a provider with the correct name for anthropic', async () => {
    const provider = await loadProvider(baseConfig);
    expect(provider.name).toBe('anthropic');
  });

  it('returns a provider with the correct name for openai', async () => {
    const provider = await loadProvider({ ...baseConfig, provider: 'openai', apiKey: 'sk-test' });
    expect(provider.name).toBe('openai');
  });

  it('returns a provider with the correct name for gemini', async () => {
    const provider = await loadProvider({ ...baseConfig, provider: 'gemini', apiKey: 'AIza-test' });
    expect(provider.name).toBe('gemini');
  });

  it('returns a provider with the correct name for ollama', async () => {
    const provider = await loadProvider({ ...baseConfig, provider: 'ollama', apiKey: undefined });
    expect(provider.name).toBe('ollama');
  });

  it('throws ProviderError for unknown provider name', async () => {
    const badConfig = { ...baseConfig, provider: 'unknown' as never };
    await expect(loadProvider(badConfig)).rejects.toBeInstanceOf(ProviderError);
  });

  it('provider exposes all required interface methods', async () => {
    const provider = await loadProvider(baseConfig);
    expect(typeof provider.complete).toBe('function');
    expect(typeof provider.embed).toBe('function');
    expect(typeof provider.estimateCost).toBe('function');
    expect(typeof provider.healthCheck).toBe('function');
    expect(typeof provider.defaultModel).toBe('string');
  });
});

describe('loadEchoProvider', () => {
  it('returns a provider for anthropic echo', async () => {
    const provider = await loadEchoProvider(baseConfig);
    expect(provider.name).toBe('anthropic');
  });

  it('returns a provider for openai echo', async () => {
    const provider = await loadEchoProvider({ ...baseConfig, provider: 'openai', apiKey: 'sk-test' });
    expect(provider.name).toBe('openai');
  });

  it('returns a provider for ollama echo', async () => {
    const provider = await loadEchoProvider({ ...baseConfig, provider: 'ollama', apiKey: undefined });
    expect(provider.name).toBe('ollama');
  });
});

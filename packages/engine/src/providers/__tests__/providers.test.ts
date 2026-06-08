import { describe, it, expect } from 'vitest';
import { createProvider as createAnthropic } from '../anthropic.js';
import { createProvider as createOpenAI } from '../openai.js';
import { createProvider as createGemini } from '../gemini.js';
import { createProvider as createOllama } from '../ollama.js';
import type { GeodesicConfig, Message } from '@geodesic/types';
import { ProviderError } from '@geodesic/types';

// ── Anthropic ──────────────────────────────────────────────────────────────────

describe('anthropic provider', () => {
  it('throws AUTH_FAILED when apiKey is missing', () => {
    const config: GeodesicConfig = { provider: 'anthropic', analystId: 'test' };
    expect(() => createAnthropic(config)).toThrow(ProviderError);
  });

  it('estimateCost returns non-negative values', () => {
    const config: GeodesicConfig = { provider: 'anthropic', apiKey: 'sk-ant-test', analystId: 'test' };
    const provider = createAnthropic(config);
    const messages: Message[] = [{ role: 'user', content: 'hello world' }];
    const est = provider.estimateCost(messages);
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
    expect(est.estimatedOutputTokens).toBeGreaterThan(0);
    expect(est.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('estimateCost approach is thorough for sonnet', () => {
    const config: GeodesicConfig = { provider: 'anthropic', apiKey: 'sk-ant-test', analystId: 'test', model: 'claude-sonnet-4-6' };
    const provider = createAnthropic(config);
    const est = provider.estimateCost([{ role: 'user', content: 'test' }]);
    expect(est.approach).toBe('thorough');
  });

  it('estimateCost approach is fast for haiku', () => {
    const config: GeodesicConfig = { provider: 'anthropic', apiKey: 'sk-ant-test', analystId: 'test', model: 'claude-haiku-4-5-20251001' };
    const provider = createAnthropic(config);
    const est = provider.estimateCost([{ role: 'user', content: 'test' }]);
    expect(est.approach).toBe('fast');
  });

  it('has correct provider name', () => {
    const provider = createAnthropic({ provider: 'anthropic', apiKey: 'sk-ant-test', analystId: 'test' });
    expect(provider.name).toBe('anthropic');
  });
});

// ── OpenAI ─────────────────────────────────────────────────────────────────────

describe('openai provider', () => {
  it('throws AUTH_FAILED when apiKey is missing', () => {
    const config: GeodesicConfig = { provider: 'openai', analystId: 'test' };
    expect(() => createOpenAI(config)).toThrow(ProviderError);
  });

  it('estimateCost returns non-negative values', () => {
    const config: GeodesicConfig = { provider: 'openai', apiKey: 'sk-test', analystId: 'test' };
    const provider = createOpenAI(config);
    const est = provider.estimateCost([{ role: 'user', content: 'hello' }]);
    expect(est.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('estimateCost approach is fast for gpt-4o-mini', () => {
    const config: GeodesicConfig = { provider: 'openai', apiKey: 'sk-test', analystId: 'test', model: 'gpt-4o-mini' };
    const provider = createOpenAI(config);
    const est = provider.estimateCost([{ role: 'user', content: 'test' }]);
    expect(est.approach).toBe('fast');
  });

  it('has correct provider name', () => {
    const provider = createOpenAI({ provider: 'openai', apiKey: 'sk-test', analystId: 'test' });
    expect(provider.name).toBe('openai');
  });
});

// ── Gemini ─────────────────────────────────────────────────────────────────────

describe('gemini provider', () => {
  it('throws AUTH_FAILED when apiKey is missing', () => {
    const config: GeodesicConfig = { provider: 'gemini', analystId: 'test' };
    expect(() => createGemini(config)).toThrow(ProviderError);
  });

  it('estimateCost approach is fast for flash models', () => {
    const config: GeodesicConfig = { provider: 'gemini', apiKey: 'AIza-test', analystId: 'test', model: 'gemini-2.5-flash' };
    const provider = createGemini(config);
    const est = provider.estimateCost([{ role: 'user', content: 'test' }]);
    expect(est.approach).toBe('fast');
  });

  it('estimateCost approach is thorough for pro models', () => {
    const config: GeodesicConfig = { provider: 'gemini', apiKey: 'AIza-test', analystId: 'test', model: 'gemini-2.5-pro' };
    const provider = createGemini(config);
    const est = provider.estimateCost([{ role: 'user', content: 'test' }]);
    expect(est.approach).toBe('thorough');
  });

  it('has correct provider name', () => {
    const provider = createGemini({ provider: 'gemini', apiKey: 'AIza-test', analystId: 'test' });
    expect(provider.name).toBe('gemini');
  });
});

// ── Ollama ─────────────────────────────────────────────────────────────────────

describe('ollama provider', () => {
  it('estimateCost always returns zero cost', () => {
    const config: GeodesicConfig = { provider: 'ollama', analystId: 'test' };
    const provider = createOllama(config);
    const est = provider.estimateCost([{ role: 'user', content: 'hello world' }]);
    expect(est.estimatedCostUsd).toBe(0);
  });

  it('estimateCost approach is always fast', () => {
    const provider = createOllama({ provider: 'ollama', analystId: 'test' });
    const est = provider.estimateCost([{ role: 'user', content: 'test' }]);
    expect(est.approach).toBe('fast');
  });

  it('has correct provider name', () => {
    const provider = createOllama({ provider: 'ollama', analystId: 'test' });
    expect(provider.name).toBe('ollama');
  });

  it('uses configured model as defaultModel', () => {
    const provider = createOllama({ provider: 'ollama', analystId: 'test', model: 'mistral' });
    expect(provider.defaultModel).toBe('mistral');
  });

  it('healthCheck returns healthy: false when Ollama is not running', async () => {
    const config: GeodesicConfig = { provider: 'ollama', analystId: 'test', ollama: { baseUrl: 'http://localhost:19999' } };
    const provider = createOllama(config);
    const result = await provider.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });
});

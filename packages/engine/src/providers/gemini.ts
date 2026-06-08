import { GoogleGenAI } from '@google/genai';
import type {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  EmbeddingResult,
  GeodesicConfig,
  Message,
  ProviderHealthCheck,
  TokenCostEstimate,
} from '@geodesic/types';
import { ProviderError } from '@geodesic/types';
import { normalizeTo1536 } from './local-embeddings.js';

const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro':   { input: 1.25,  output: 10.00 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10,  output: 0.40 },
};

const DEFAULT_MODEL = 'gemini-2.5-pro';
const EMBEDDING_MODEL = 'text-embedding-004'; // 768 dims — normalize to 1536
const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('503');
      if (isRetryable && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function createProvider(config: GeodesicConfig): AIProvider {
  if (!config.apiKey) {
    throw new ProviderError('gemini', 'AUTH_FAILED', 'Gemini API key is required', false);
  }

  const model = config.model ?? DEFAULT_MODEL;
  const genai = new GoogleGenAI({ apiKey: config.apiKey });

  return {
    name: 'gemini',
    defaultModel: DEFAULT_MODEL,

    async complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult> {
      try {
        // Build contents array from messages (Gemini format)
        const contents = messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));

        const systemInstruction = options.systemPrompt ??
          messages.find(m => m.role === 'system')?.content;

        const response = await withRetry(() => genai.models.generateContent({
          model,
          contents,
          config: {
            maxOutputTokens: options.maxTokens,
            temperature: options.temperature,
            systemInstruction,
          },
        }));

        const text = response.text ?? '';
        const usage = response.usageMetadata;

        return {
          content: text,
          inputTokens: usage?.promptTokenCount ?? Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 4),
          outputTokens: usage?.candidatesTokenCount ?? Math.ceil(text.length / 4),
          model,
          provider: 'gemini',
        };
      } catch (err) {
        throw mapError('gemini', err);
      }
    },

    async embed(text: string): Promise<EmbeddingResult> {
      try {
        const response = await genai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: [{ parts: [{ text }] }],
        });
        const values = response.embeddings?.[0]?.values ?? [];
        return {
          embedding: normalizeTo1536(values),
          inputTokens: Math.ceil(text.length / 4),
        };
      } catch (err) {
        throw mapError('gemini', err);
      }
    },

    estimateCost(messages: Message[]): TokenCostEstimate {
      const pricing = PRICING[model] ?? PRICING[DEFAULT_MODEL] ?? { input: 1.25, output: 10.00 };
      const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const outputTokens = Math.ceil(inputTokens * 0.3);
      const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
      return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: costUsd,
        approach: model.includes('flash') ? 'fast' : 'thorough',
      };
    },

    async healthCheck(): Promise<ProviderHealthCheck> {
      const start = Date.now();
      try {
        await genai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ parts: [{ text: 'ping' }] }],
          config: { maxOutputTokens: 5 },
        });
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  };
}

export function createEchoProvider(config: GeodesicConfig): AIProvider {
  return createProvider({ ...config, model: 'gemini-2.5-flash' });
}

function mapError(provider: string, err: unknown): ProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Gemini billing: free-tier quota exhaustion vs paid quota — both surface as RESOURCE_EXHAUSTED.
  // Only treat as INSUFFICIENT_CREDITS when "billing" or "free tier" is in the message.
  if (
    lower.includes('billing') ||
    lower.includes('free tier') ||
    lower.includes('free_tier') ||
    lower.includes('please enable billing')
  ) {
    return new ProviderError(
      provider,
      'INSUFFICIENT_CREDITS',
      'Gemini: billing quota exhausted. Enable billing at https://console.cloud.google.com/billing then retry.',
      false,
    );
  }
  if (msg.includes('API_KEY') || msg.includes('401') || msg.includes('PERMISSION_DENIED')) {
    return new ProviderError(
      provider,
      'AUTH_FAILED',
      'Gemini: API key rejected. Get a new key at https://aistudio.google.com/app/apikey and re-run "Configure AI Provider".',
      false,
    );
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return new ProviderError(
      provider,
      'RATE_LIMITED',
      'Gemini: rate limited — too many requests. The engine will retry automatically.',
      true,
    );
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return new ProviderError(provider, 'MODEL_NOT_FOUND', `Gemini: model not found — ${msg}`, false);
  }
  if (lower.includes('context length') || msg.includes('INVALID_ARGUMENT')) {
    return new ProviderError(provider, 'CONTEXT_EXCEEDED', 'Gemini: context window exceeded for this repo. Try a smaller subset.', false);
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch')) {
    return new ProviderError(provider, 'NETWORK_ERROR', `Gemini: network error — ${msg}. Check your internet connection.`, true);
  }
  return new ProviderError(provider, 'UNKNOWN', msg, false);
}

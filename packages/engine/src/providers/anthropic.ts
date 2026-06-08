import Anthropic from '@anthropic-ai/sdk';
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
import { localEmbed } from './local-embeddings.js';

// Public pricing (input/output per 1M tokens) — approximate, used for estimation only
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':           { input: 15.00,  output: 75.00 },
  'claude-sonnet-4-6':         { input: 3.00,   output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.25,   output: 1.25 },
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 8 * 60_000;
const MAX_RETRIES = 3;

async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (
        err instanceof Anthropic.APIError &&
        (err.status === 429 || err.status === 503) &&
        attempt < MAX_RETRIES
      ) {
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
    throw new ProviderError('anthropic', 'AUTH_FAILED', 'Anthropic API key is required', false);
  }

  const model = config.model ?? DEFAULT_MODEL;
  const extendedThinking = config.advanced?.extendedThinking === true;
  // Prompt caching is GA — no beta header required. The `cache_control: { type: 'ephemeral' }`
  // markers on the system message activate caching directly. Sending the legacy
  // `anthropic-beta: prompt-caching-1` header now returns 400 ("Unexpected value(s)").
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'anthropic',
    defaultModel: DEFAULT_MODEL,

    async complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult> {
      const systemContent = options.systemPrompt ?? '';
      const userMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      try {
        const response = await withRetry(signal => {
          const stream = client.messages.stream(
            {
              model,
              max_tokens: options.maxTokens,
              temperature: extendedThinking ? undefined : options.temperature,
              system: systemContent
                ? [{ type: 'text', text: systemContent, cache_control: { type: 'ephemeral' } }]
                : undefined,
              messages: userMessages,
              ...(extendedThinking ? { thinking: { type: 'enabled', budget_tokens: 10000 } } : {}),
            },
            { signal },
          );
          return stream.finalMessage();
        });

        const textContent = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as { text: string }).text)
          .join('');

        return {
          content: textContent,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          model: response.model,
          provider: 'anthropic',
        };
      } catch (err) {
        throw mapError('anthropic', err);
      }
    },

    async embed(text: string): Promise<EmbeddingResult> {
      // Anthropic has no native embedding API — use local fallback
      return localEmbed(text);
    },

    estimateCost(messages: Message[]): TokenCostEstimate {
      const pricing = PRICING[model] ?? PRICING[DEFAULT_MODEL] ?? { input: 3.00, output: 15.00 };
      const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const outputTokens = Math.ceil(inputTokens * 0.3);
      const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
      return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: costUsd,
        approach: model.includes('haiku') ? 'fast' : 'thorough',
      };
    },

    async healthCheck(): Promise<ProviderHealthCheck> {
      const start = Date.now();
      try {
        await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  };
}

export function createEchoProvider(config: GeodesicConfig): AIProvider {
  return createProvider({ ...config, model: 'claude-haiku-4-5-20251001' });
}

function mapError(provider: string, err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const lower = err.message.toLowerCase();

    // Billing errors come back as 400 invalid_request_error with "credit balance is too low"
    if (lower.includes('credit balance') || lower.includes('credit_balance') || lower.includes('billing')) {
      return new ProviderError(
        provider,
        'INSUFFICIENT_CREDITS',
        'Anthropic: out of credits. Add billing at https://console.anthropic.com/settings/billing then retry.',
        false,
      );
    }
    if (err.status === 401) {
      return new ProviderError(
        provider,
        'AUTH_FAILED',
        'Anthropic: API key rejected. Get a new key at https://console.anthropic.com/settings/keys and re-run "Configure AI Provider".',
        false,
      );
    }
    if (err.status === 429) {
      return new ProviderError(
        provider,
        'RATE_LIMITED',
        'Anthropic: rate limited — too many requests. The engine will retry automatically; if it persists, wait a minute and re-run.',
        true,
      );
    }
    if (err.status === 404) {
      return new ProviderError(provider, 'MODEL_NOT_FOUND', `Anthropic: model not found — ${err.message}`, false);
    }
    if (err.status === 413 || lower.includes('context')) {
      return new ProviderError(provider, 'CONTEXT_EXCEEDED', `Anthropic: context window exceeded for this repo. Try a smaller subset.`, false);
    }
    if (err.status === 400) {
      return new ProviderError(provider, 'UNKNOWN', `Anthropic rejected the request: ${err.message}`, false);
    }
  }
  if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('fetch'))) {
    return new ProviderError(provider, 'NETWORK_ERROR', `Anthropic: network error — ${err.message}. Check your internet connection.`, true);
  }
  return new ProviderError(provider, 'UNKNOWN', err instanceof Error ? err.message : String(err), false);
}

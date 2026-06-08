import OpenAI from 'openai';
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
  'gpt-4o':       { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60 },
  'o3':           { input: 10.00, output: 40.00 },
  'o4-mini':      { input: 1.10,  output: 4.40 },
};

const DEFAULT_MODEL = 'gpt-4o';
const EMBEDDING_MODEL = 'text-embedding-3-large'; // 1536 dims — no normalization needed
const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof OpenAI.APIError && (err.status === 429 || err.status === 503) && attempt < MAX_RETRIES) {
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
    throw new ProviderError('openai', 'AUTH_FAILED', 'OpenAI API key is required', false);
  }

  const model = config.model ?? DEFAULT_MODEL;
  const client = new OpenAI({ apiKey: config.apiKey });

  return {
    name: 'openai',
    defaultModel: DEFAULT_MODEL,

    async complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult> {
      const oaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = options.systemPrompt
        ? [{ role: 'system', content: options.systemPrompt }, ...messages]
        : [...messages];

      try {
        return await withRetry(async () => {
          const stream = await client.chat.completions.create({
            model,
            max_tokens: options.maxTokens,
            temperature: options.temperature,
            messages: oaiMessages,
            stream: true,
            stream_options: { include_usage: true },
          });

          let content = '';
          let inputTokens = 0;
          let outputTokens = 0;
          let responseModel = model;

          for await (const chunk of stream) {
            content += chunk.choices[0]?.delta.content ?? '';
            if (chunk.model) responseModel = chunk.model;
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens;
              outputTokens = chunk.usage.completion_tokens;
            }
          }

          // Fallback if stream closed before sending a usage chunk (e.g. edge proxy stripped it)
          if (inputTokens === 0) {
            inputTokens = Math.ceil(oaiMessages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0) / 3);
            outputTokens = Math.ceil(content.length / 3);
          }

          return { content, inputTokens, outputTokens, model: responseModel, provider: 'openai' };
        });
      } catch (err) {
        throw mapError('openai', err);
      }
    },

    async embed(text: string): Promise<EmbeddingResult> {
      try {
        const response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: text,
        });
        const rawEmbedding = response.data[0]?.embedding ?? [];
        return {
          embedding: normalizeTo1536(rawEmbedding),
          inputTokens: response.usage.prompt_tokens,
        };
      } catch (err) {
        throw mapError('openai', err);
      }
    },

    estimateCost(messages: Message[]): TokenCostEstimate {
      const pricing = PRICING[model] ?? PRICING[DEFAULT_MODEL] ?? { input: 2.50, output: 10.00 };
      const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const outputTokens = Math.ceil(inputTokens * 0.3);
      const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
      return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: costUsd,
        approach: model.includes('mini') ? 'fast' : 'thorough',
      };
    },

    async healthCheck(): Promise<ProviderHealthCheck> {
      const start = Date.now();
      try {
        await client.chat.completions.create({
          model: 'gpt-4o-mini',
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
  return createProvider({ ...config, model: 'gpt-4o-mini' });
}

function mapError(provider: string, err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const lower = err.message.toLowerCase();
    const code = (err as { code?: string }).code ?? '';

    // OpenAI billing: insufficient_quota, billing_hard_limit_reached, or "exceeded your current quota"
    if (
      code === 'insufficient_quota' ||
      code === 'billing_hard_limit_reached' ||
      lower.includes('insufficient_quota') ||
      lower.includes('exceeded your current quota') ||
      lower.includes('billing hard limit')
    ) {
      return new ProviderError(
        provider,
        'INSUFFICIENT_CREDITS',
        'OpenAI: out of credits / quota exceeded. Add billing at https://platform.openai.com/settings/organization/billing then retry.',
        false,
      );
    }
    if (err.status === 401) {
      return new ProviderError(
        provider,
        'AUTH_FAILED',
        'OpenAI: API key rejected. Get a new key at https://platform.openai.com/api-keys and re-run "Configure AI Provider".',
        false,
      );
    }
    if (err.status === 429) {
      return new ProviderError(
        provider,
        'RATE_LIMITED',
        'OpenAI: rate limited — too many requests. The engine will retry automatically.',
        true,
      );
    }
    if (err.status === 404) {
      return new ProviderError(provider, 'MODEL_NOT_FOUND', `OpenAI: model not found — ${err.message}`, false);
    }
    if (err.status === 400 && lower.includes('context')) {
      return new ProviderError(provider, 'CONTEXT_EXCEEDED', 'OpenAI: context window exceeded for this repo. Try a smaller subset.', false);
    }
    if (err.status === 400) {
      return new ProviderError(provider, 'UNKNOWN', `OpenAI rejected the request: ${err.message}`, false);
    }
  }
  if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('fetch'))) {
    return new ProviderError(provider, 'NETWORK_ERROR', `OpenAI: network error — ${err.message}. Check your internet connection.`, true);
  }
  return new ProviderError(provider, 'UNKNOWN', err instanceof Error ? err.message : String(err), false);
}

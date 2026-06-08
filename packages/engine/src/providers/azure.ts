import { AzureOpenAI } from 'openai';
import type OpenAI from 'openai';
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
import { localEmbed, normalizeTo1536 } from './local-embeddings.js';

// Public Azure OpenAI pricing mirrors base OpenAI pricing (per 1M tokens)
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':      { input: 2.50,  output: 10.00 },
  'gpt-4o-mini': { input: 0.15,  output: 0.60 },
  'o3':          { input: 10.00, output: 40.00 },
  'o4-mini':     { input: 1.10,  output: 4.40 },
};

const DEFAULT_PRICING: { input: number; output: number } = { input: 2.50, output: 10.00 };
const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof AzureOpenAI.APIError && (err.status === 429 || err.status === 503) && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 30_000)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function pickPricing(deploymentName: string): { input: number; output: number } {
  for (const [key, val] of Object.entries(PRICING)) {
    if (deploymentName.toLowerCase().includes(key)) return val;
  }
  return DEFAULT_PRICING;
}

export function createProvider(config: GeodesicConfig): AIProvider {
  const azure = config.azure;
  if (!azure) {
    throw new ProviderError('azure', 'AUTH_FAILED', 'Azure config block is required', false);
  }
  if (!config.apiKey) {
    throw new ProviderError('azure', 'AUTH_FAILED', 'Azure API key is required', false);
  }

  const { endpoint, deploymentName, apiVersion, embeddingDeploymentName } = azure;

  const client = new AzureOpenAI({
    apiKey: config.apiKey,
    endpoint,
    apiVersion,
    deployment: deploymentName,
  });

  const embeddingSetup = embeddingDeploymentName != null
    ? {
        client: new AzureOpenAI({
          apiKey: config.apiKey,
          endpoint,
          apiVersion,
          deployment: embeddingDeploymentName,
        }),
        name: embeddingDeploymentName,
      }
    : null;

  const pricing = pickPricing(deploymentName);

  return {
    name: 'azure',
    defaultModel: deploymentName,

    async complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult> {
      const oaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = options.systemPrompt
        ? [{ role: 'system', content: options.systemPrompt }, ...messages]
        : [...messages];

      try {
        return await withRetry(async () => {
          const stream = await client.chat.completions.create({
            model: deploymentName,
            max_tokens: options.maxTokens,
            temperature: options.temperature,
            messages: oaiMessages,
            stream: true,
            stream_options: { include_usage: true },
          });

          let content = '';
          let inputTokens = 0;
          let outputTokens = 0;

          for await (const chunk of stream) {
            content += chunk.choices[0]?.delta.content ?? '';
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens;
              outputTokens = chunk.usage.completion_tokens;
            }
          }

          return { content, inputTokens, outputTokens, model: deploymentName, provider: 'azure' };
        });
      } catch (err) {
        throw mapError('azure', err);
      }
    },

    async embed(text: string): Promise<EmbeddingResult> {
      if (!embeddingSetup) {
        return localEmbed(text);
      }
      try {
        const response = await embeddingSetup.client.embeddings.create({
          model: embeddingSetup.name,
          input: text,
        });
        const raw = response.data[0]?.embedding ?? [];
        return {
          embedding: normalizeTo1536(raw),
          inputTokens: response.usage.prompt_tokens,
        };
      } catch (err) {
        throw mapError('azure', err);
      }
    },

    estimateCost(messages: Message[]): TokenCostEstimate {
      const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const outputTokens = Math.ceil(inputTokens * 0.3);
      const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
      return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: costUsd,
        approach: deploymentName.includes('mini') ? 'fast' : 'thorough',
      };
    },

    async healthCheck(): Promise<ProviderHealthCheck> {
      const start = Date.now();
      try {
        await client.chat.completions.create({
          model: deploymentName,
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
  // Azure has only one deployment per resource — reuse the same config
  return createProvider(config);
}

function mapError(provider: string, err: unknown): ProviderError {
  if (err instanceof AzureOpenAI.APIError) {
    const lower = err.message.toLowerCase();
    const code = (err as { code?: string }).code ?? '';

    if (
      code === 'insufficient_quota' ||
      lower.includes('quota') ||
      lower.includes('billing') ||
      lower.includes('subscription')
    ) {
      return new ProviderError(
        provider,
        'INSUFFICIENT_CREDITS',
        'Azure OpenAI: quota exhausted or subscription issue. Check Azure portal billing then retry.',
        false,
      );
    }
    if (err.status === 401) {
      return new ProviderError(
        provider,
        'AUTH_FAILED',
        'Azure OpenAI: API key rejected. Verify your key in the Azure portal and re-run "Configure AI Provider".',
        false,
      );
    }
    if (err.status === 429) {
      return new ProviderError(
        provider,
        'RATE_LIMITED',
        'Azure OpenAI: rate limited — too many requests. The engine will retry automatically.',
        true,
      );
    }
    if (err.status === 404) {
      return new ProviderError(provider, 'MODEL_NOT_FOUND', `Azure OpenAI: deployment not found — ${err.message}. Check your deployment name.`, false);
    }
    if (err.status === 400 && lower.includes('context')) {
      return new ProviderError(provider, 'CONTEXT_EXCEEDED', 'Azure OpenAI: context window exceeded for this repo. Try a smaller subset.', false);
    }
    if (err.status === 400) {
      return new ProviderError(provider, 'UNKNOWN', `Azure OpenAI rejected the request: ${err.message}`, false);
    }
  }
  if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('fetch'))) {
    return new ProviderError(provider, 'NETWORK_ERROR', `Azure OpenAI: network error — ${err.message}. Check your endpoint URL and internet connection.`, true);
  }
  return new ProviderError(provider, 'UNKNOWN', err instanceof Error ? err.message : String(err), false);
}

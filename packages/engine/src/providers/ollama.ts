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

const DEFAULT_BASE_URL = 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text'; // 768 dims — normalize to 1536

interface OllamaChatChunk {
  message?: { role?: string; content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
  error?: string;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
  error?: string;
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

export function createProvider(config: GeodesicConfig): AIProvider {
  const model = config.model ?? 'llama3.3';
  const baseUrl = (config.ollama?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

  async function post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError('ollama', 'NETWORK_ERROR', msg, true);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 404) {
        throw new ProviderError('ollama', 'MODEL_NOT_FOUND', text || 'Model not found', false);
      }
      throw new ProviderError('ollama', 'UNKNOWN', text || `HTTP ${String(response.status)}`, false);
    }

    return response.json() as Promise<T>;
  }

  return {
    name: 'ollama',
    defaultModel: model,

    async complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult> {
      const ollamaMessages = options.systemPrompt
        ? [{ role: 'system', content: options.systemPrompt }, ...messages]
        : [...messages];

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: ollamaMessages,
            stream: true,
            options: { num_predict: options.maxTokens, temperature: options.temperature },
          }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ProviderError('ollama', 'NETWORK_ERROR', msg, true);
      }

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new ProviderError('ollama', 'UNKNOWN', text || `HTTP ${String(response.status)}`, false);
      }

      let content = '';
      let inputTokens = 0;
      let outputTokens = 0;
      const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const decoder = new TextDecoder();
      // lineBuffer accumulates bytes across read() calls so JSON split across TCP chunks is parsed whole
      let lineBuffer = '';

      function processLine(line: string): void {
        if (!line) return;
        try {
          const chunk = JSON.parse(line) as OllamaChatChunk;
          if (chunk.error) throw new ProviderError('ollama', 'UNKNOWN', chunk.error, false);
          content += chunk.message?.content ?? '';
          if (chunk.done) {
            inputTokens = chunk.prompt_eval_count ?? Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 3);
            outputTokens = chunk.eval_count ?? Math.ceil(content.length / 3);
          }
        } catch (parseErr) {
          if (parseErr instanceof ProviderError) throw parseErr;
          // Silently skip malformed partial lines
        }
      }

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        // Keep the last (potentially incomplete) fragment in the buffer
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line.trim());
        }
      }
      // Flush any remaining content after the stream closes
      if (lineBuffer.trim()) processLine(lineBuffer.trim());

      // Fallback if Ollama never sent token counts
      if (inputTokens === 0) {
        inputTokens = Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 3);
        outputTokens = Math.ceil(content.length / 3);
      }

      return { content, inputTokens, outputTokens, model, provider: 'ollama' };
    },

    async embed(text: string): Promise<EmbeddingResult> {
      let data: OllamaEmbeddingResponse;
      try {
        data = await post<OllamaEmbeddingResponse>('/api/embeddings', {
          model: EMBEDDING_MODEL,
          prompt: text,
        });
      } catch (err) {
        // nomic-embed-text not available — fall back to local
        if (err instanceof ProviderError && err.code === 'MODEL_NOT_FOUND') {
          return localEmbed(text);
        }
        throw err;
      }

      if (data.error) {
        return localEmbed(text);
      }

      return {
        embedding: normalizeTo1536(data.embedding),
        inputTokens: Math.ceil(text.length / 4),
      };
    },

    estimateCost(messages: Message[]): TokenCostEstimate {
      const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const outputTokens = Math.ceil(inputTokens * 0.3);
      return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: 0,
        approach: 'fast',
      };
    },

    async healthCheck(): Promise<ProviderHealthCheck> {
      const start = Date.now();
      try {
        let response: Response;
        try {
          response = await fetch(`${baseUrl}/api/tags`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { healthy: false, latencyMs: Date.now() - start, error: msg };
        }

        if (!response.ok) {
          return { healthy: false, latencyMs: Date.now() - start, error: `HTTP ${String(response.status)}` };
        }

        const tags = await response.json() as OllamaTagsResponse;
        const available = tags.models.some(m => m.name.startsWith(model.split(':')[0] ?? model));
        if (!available) {
          return {
            healthy: false,
            latencyMs: Date.now() - start,
            error: `Model "${model}" not found. Run: ollama pull ${model}`,
          };
        }

        return { healthy: true, latencyMs: Date.now() - start };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  };
}

export function createEchoProvider(config: GeodesicConfig): AIProvider {
  // Ollama has no cost distinction — reuse the same model
  return createProvider(config);
}

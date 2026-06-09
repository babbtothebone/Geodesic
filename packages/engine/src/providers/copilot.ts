/**
 * Copilot provider — runs vscode.lm calls via the reverse IPC bridge.
 *
 * The provider itself is vscode-agnostic; it only talks to `LmBridge`.
 * When Geodesic is launched standalone (no extension), `bridgeFromEnv()`
 * returns null and this provider throws COPILOT_UNAVAILABLE with a
 * clear remediation message.
 */

import type {
  AIProvider,
  CompletionOptions,
  CompletionResult,
  CopilotProviderConfig,
  EmbeddingResult,
  GeodesicConfig,
  Message,
  ProviderErrorCode,
  ProviderHealthCheck,
  TokenCostEstimate,
} from '@geodesic/types';
import { ProviderError } from '@geodesic/types';
import { localEmbed } from './local-embeddings.js';
import { bridgeFromEnv, BridgeHttpError, type LmBridge } from './lm-bridge-client.js';

const DEFAULT_VENDOR = 'copilot';
const DEFAULT_FAMILY = 'claude-3.5-sonnet';

const KNOWN_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'AUTH_FAILED', 'INSUFFICIENT_CREDITS', 'RATE_LIMITED',
  'MODEL_NOT_FOUND', 'CONTEXT_EXCEEDED', 'NETWORK_ERROR', 'UNKNOWN',
]);

function toProviderErrorCode(code: string): ProviderErrorCode {
  return (KNOWN_CODES.has(code as ProviderErrorCode) ? code : 'UNKNOWN') as ProviderErrorCode;
}

function getBridge(): LmBridge {
  const bridge = bridgeFromEnv();
  if (!bridge) {
    throw new ProviderError(
      'copilot',
      'NETWORK_ERROR',
      'Copilot provider requires the VS Code extension. ' +
        'GEODESIC_LM_BRIDGE_PORT is not set — the engine was launched outside the extension host. ' +
        'Open the workspace in VS Code with the Geodesic extension installed and signed into GitHub Copilot.',
      false,
    );
  }
  return bridge;
}

export function createProvider(config: GeodesicConfig): AIProvider {
  const cp: CopilotProviderConfig = config.copilot ?? {};
  const vendor = cp.vendor ?? DEFAULT_VENDOR;
  const family = cp.family ?? config.model ?? DEFAULT_FAMILY;

  return {
    name: 'copilot',
    defaultModel: family,

    async complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult> {
      const bridge = getBridge();
      try {
        const result = await bridge.complete({
          messages: messages.filter(m => m.role !== 'system'),
          systemPrompt: options.systemPrompt,
          maxTokens: cp.maxTokens ?? options.maxTokens,
          temperature: options.temperature,
          family,
          vendor,
        });
        return {
          content: result.content,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          model: result.model,
          provider: 'copilot',
        };
      } catch (err) {
        throw mapError(err);
      }
    },

    async embed(text: string): Promise<EmbeddingResult> {
      // vscode.lm doesn't expose an embedding API. Use the local fallback.
      return localEmbed(text);
    },

    estimateCost(messages: Message[]): TokenCostEstimate {
      // Copilot usage is covered by the user's GitHub Copilot subscription —
      // there's no marginal token cost to surface.
      const inputTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
      const outputTokens = Math.ceil(inputTokens * 0.3);
      return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUsd: 0,
        approach: family.includes('haiku') || family.includes('mini') ? 'fast' : 'thorough',
      };
    },

    async healthCheck(): Promise<ProviderHealthCheck> {
      const start = Date.now();
      try {
        const bridge = getBridge();
        const hc = await bridge.healthCheck();
        return {
          healthy: hc.ok,
          latencyMs: Date.now() - start,
          error: hc.ok ? undefined : hc.message,
        };
      } catch (err) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export function createEchoProvider(config: GeodesicConfig): AIProvider {
  // The bridge picks the cheapest available model when family is omitted.
  // For the echo (shadow) provider, prefer a "mini"/"haiku" if config supplied
  // one — otherwise let the bridge fall back to its first available model.
  return createProvider(config);
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof BridgeHttpError) {
    return new ProviderError('copilot', toProviderErrorCode(err.code), err.message, err.retryable);
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return new ProviderError(
        'copilot',
        'NETWORK_ERROR',
        'Copilot bridge request timed out. The model may be slow or unavailable; try again.',
        true,
      );
    }
    if (err.message.includes('ECONNREFUSED')) {
      // Server really is gone — the only case where reloading actually helps.
      return new ProviderError(
        'copilot',
        'NETWORK_ERROR',
        `Copilot bridge is down (${err.message}). Reload the VS Code window so the extension can restart the bridge.`,
        true,
      );
    }
    if (err.message.toLowerCase().includes('fetch failed') || err.message.toLowerCase().includes('econnreset') || err.message.toLowerCase().includes('socket hang up')) {
      // Transient transport error that survived the bridge client's retry loop.
      // The bridge HTTP server is probably still up — don't tell the user to reload.
      const cause = (err as { cause?: unknown }).cause;
      const causeMsg = cause instanceof Error ? `: ${cause.message}` : (typeof cause === 'object' && cause !== null && 'code' in cause ? ` (${String(cause.code)})` : '');
      return new ProviderError(
        'copilot',
        'NETWORK_ERROR',
        `Copilot bridge transport error${causeMsg} after retries: ${err.message}. The bridge may be overloaded; reducing synthesis parallelism may help.`,
        true,
      );
    }
  }
  return new ProviderError('copilot', 'UNKNOWN', err instanceof Error ? err.message : String(err), false);
}

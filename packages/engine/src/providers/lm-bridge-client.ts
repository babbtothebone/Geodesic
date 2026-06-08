/**
 * LM Bridge Client — engine-side adapter for the reverse-IPC channel.
 *
 * The Copilot provider runs inside the engine subprocess, which is
 * vscode-agnostic by design. To reach `vscode.lm`, the extension hosts a
 * tiny localhost HTTP server (`lm-bridge-server.ts`) and passes its port
 * to the engine via `GEODESIC_LM_BRIDGE_PORT`. This module is the engine's
 * client for that channel.
 *
 * Wire format:
 *   POST /lm/complete
 *   { messages: [{role,content}...], systemPrompt?, maxTokens, temperature,
 *     family?, vendor? }
 *   → 200 { content, inputTokens, outputTokens, model }
 *   → 4xx/5xx { error: { code, message, retryable } }
 *
 * No streaming — matches the synchronous `AIProvider.complete()` contract.
 */

export interface LmBridgeCompleteRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  family?: string;
  vendor?: string;
}

export interface LmBridgeCompleteResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LmBridgeErrorBody {
  error: {
    /** Matches ProviderErrorCode. */
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface LmBridge {
  complete(req: LmBridgeCompleteRequest): Promise<LmBridgeCompleteResponse>;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}

const REQUEST_TIMEOUT_MS = 8 * 60_000;

export class HttpLmBridge implements LmBridge {
  constructor(private readonly port: number, private readonly token: string) {}

  private url(p: string): string {
    return `http://127.0.0.1:${String(this.port)}${p}`;
  }

  private authHeaders(): Record<string, string> {
    return { 'X-Bridge-Token': this.token };
  }

  async complete(req: LmBridgeCompleteRequest): Promise<LmBridgeCompleteResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(this.url('/lm/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        let parsed: LmBridgeErrorBody | null = null;
        try { parsed = JSON.parse(text) as LmBridgeErrorBody; } catch { /* keep raw */ }
        const err = new BridgeHttpError(
          parsed?.error.code ?? 'UNKNOWN',
          parsed?.error.message ?? (text || `HTTP ${String(resp.status)}`),
          parsed?.error.retryable ?? false,
        );
        throw err;
      }
      return JSON.parse(text) as LmBridgeCompleteResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const resp = await fetch(this.url('/lm/health'), { headers: this.authHeaders(), signal: AbortSignal.timeout(5_000) });
      if (!resp.ok) return { ok: false, message: `HTTP ${String(resp.status)}` };
      const body = await resp.json() as { ok?: boolean; message?: string };
      return { ok: body.ok ?? false, message: body.message ?? '' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Error from the bridge transport. Wraps the structured error body. */
export class BridgeHttpError extends Error {
  override readonly name = 'BridgeHttpError';
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Constructs a bridge from the env var the extension sets at spawn time. */
export function bridgeFromEnv(): LmBridge | null {
  const raw = process.env.GEODESIC_LM_BRIDGE_PORT;
  const token = process.env.GEODESIC_LM_BRIDGE_TOKEN;
  if (!raw || !token) return null;
  const port = parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return new HttpLmBridge(port, token);
}

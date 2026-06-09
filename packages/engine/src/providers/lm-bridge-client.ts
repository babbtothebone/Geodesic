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
const MAX_TRANSPORT_RETRIES = 2;

/**
 * Distinguishes transport-layer failures (socket reset, connection drop,
 * abort) from real server responses. Used to gate the in-flight retry
 * inside `complete()`. We deliberately do NOT match on the literal string
 * "fetch failed" alone — that is too broad and would mask real errors.
 */
function isTransientTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false; // Caller-initiated; do not retry.
  const msg = err.message.toLowerCase();
  // undici / Node fetch wraps low-level socket errors in a generic
  // "fetch failed" TypeError with the real cause on `err.cause`.
  if (msg.includes('econnreset')) return true;
  if (msg.includes('socket hang up')) return true;
  if (msg.includes('econnrefused')) return false; // Server is actually down.
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const code = (cause as { code?: string }).code;
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return true;
  }
  // Generic "fetch failed" with no cause we recognise: retry once, conservatively.
  return msg === 'fetch failed';
}

export class HttpLmBridge implements LmBridge {
  constructor(private readonly port: number, private readonly token: string) {}

  private url(p: string): string {
    return `http://127.0.0.1:${String(this.port)}${p}`;
  }

  private authHeaders(): Record<string, string> {
    return { 'X-Bridge-Token': this.token };
  }

  async complete(req: LmBridgeCompleteRequest): Promise<LmBridgeCompleteResponse> {
    // Retry transient transport failures (undici socket reset, connection drop)
    // up to MAX_TRANSPORT_RETRIES times. We hit these in practice when the
    // synthesis pipeline fires 3 calls in parallel (arch-map + skill-file +
    // gap-report integration phase) and the bridge HTTP server occasionally
    // races on socket teardown. Application errors (4xx/5xx with a structured
    // body) are NOT retried here — the server already decided.
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
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
          throw new BridgeHttpError(
            parsed?.error.code ?? 'UNKNOWN',
            parsed?.error.message ?? (text || `HTTP ${String(resp.status)}`),
            parsed?.error.retryable ?? false,
          );
        }
        return JSON.parse(text) as LmBridgeCompleteResponse;
      } catch (err) {
        lastErr = err;
        // BridgeHttpError = real server response; never retry here.
        if (err instanceof BridgeHttpError) throw err;
        if (!isTransientTransportError(err) || attempt === MAX_TRANSPORT_RETRIES) throw err;
        // Tiny backoff (50ms, 150ms, 350ms) before retrying.
        await new Promise<void>(resolve => setTimeout(resolve, 50 * Math.pow(3, attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
    // Unreachable — the loop either returns or throws — but TS needs it.
    throw lastErr;
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

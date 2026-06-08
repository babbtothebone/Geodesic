/**
 * LM Bridge Server — runs inside the VS Code extension host.
 *
 * Engine subprocesses can't call `vscode.lm` directly (no vscode module
 * outside the extension host). This server exposes the LM API as a tiny
 * loopback-only HTTP endpoint, and the engine's Copilot provider talks to
 * it over localhost. The bridge port is passed via the
 * `GEODESIC_LM_BRIDGE_PORT` env var the extension injects at spawn time.
 *
 * Security:
 *   - Binds 127.0.0.1 only — never reachable from another host.
 *   - Requires a per-launch shared secret in the `X-Bridge-Token` header.
 *     The engine reads the secret from `GEODESIC_LM_BRIDGE_TOKEN`.
 *   - Rejects requests whose remote address isn't 127.0.0.1 / ::1.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

/**
 * Shared-bridge lockfile.
 *
 * Multiple VS Code windows would otherwise each spawn their own bridge with their own random
 * token, then race to inject env vars into engine subprocesses — leading to
 * "invalid X-Bridge-Token" auth failures when an engine talks to the wrong bridge.
 *
 * Solution: the first window writes its {port, token, pid} into ~/.geodesic/bridge.json.
 * Subsequent windows read the lockfile, health-check the owner's bridge, and reuse it.
 * If the owner is dead (PID gone or health check fails), the next window claims ownership.
 *
 * This is a per-user resource — the bridge is bound to 127.0.0.1 and gated by a per-launch
 * token, so cross-user collisions are not a concern.
 */
const LOCKFILE_PATH = path.join(os.homedir(), '.geodesic', 'bridge.json');

interface BridgeLockfile {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

function readLockfile(): BridgeLockfile | null {
  try {
    if (!fs.existsSync(LOCKFILE_PATH)) return null;
    const raw = fs.readFileSync(LOCKFILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BridgeLockfile>;
    if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string' || typeof parsed.pid !== 'number') return null;
    return parsed as BridgeLockfile;
  } catch { return null; }
}

function writeLockfile(info: BridgeLockfile): void {
  try {
    fs.mkdirSync(path.dirname(LOCKFILE_PATH), { recursive: true });
    fs.writeFileSync(LOCKFILE_PATH, JSON.stringify(info, null, 2), 'utf8');
  } catch { /* non-fatal — worst case the next window can't reuse and starts its own */ }
}

function deleteLockfile(): void {
  try { fs.unlinkSync(LOCKFILE_PATH); } catch { /* ignore */ }
}

/** True if a process with the given PID is currently alive. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't actually signal
    return true;
  } catch {
    return false;
  }
}

/** Probe an existing bridge to confirm it's actually responsive. */
async function healthCheckBridge(port: number, token: string): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${String(port)}/lm/health`, {
      headers: { 'X-Bridge-Token': token },
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch { return false; }
}

interface LmCompleteRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  family?: string;
  vendor?: string;
}

interface LmCompleteResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface LmErrorBody {
  error: { code: string; message: string; retryable: boolean };
}

const DEFAULT_VENDOR = 'copilot';
const DEFAULT_FAMILY = 'claude-3.5-sonnet';
const MAX_REQUEST_BYTES = 8 * 1024 * 1024; // 8MB — synthesis prompts are large

export interface LmBridgeServerInfo {
  port: number;
  token: string;
}

export class LmBridgeServer implements vscode.Disposable {
  private server: http.Server | null = null;
  private _port = 0;
  private readonly _token = crypto.randomBytes(24).toString('hex');

  get port(): number { return this._port; }
  get token(): string { return this._token; }
  get info(): LmBridgeServerInfo { return { port: this._port, token: this._token }; }

  // True when this instance owns the bridge HTTP server. False when we're a follower
  // reusing another window's bridge — in that case we never bound a port and we must
  // not delete the lockfile on dispose.
  private _isOwner = false;
  get isOwner(): boolean { return this._isOwner; }

  /**
   * Acquire access to a bridge. If another VS Code window already owns one (and it's
   * healthy), reuse it. Otherwise bind a fresh HTTP server and claim ownership.
   */
  async start(): Promise<LmBridgeServerInfo> {
    if (this.server || this._port > 0) return this.info;

    // ── Phase 1: try to reuse an existing bridge from another window ──
    const existing = readLockfile();
    if (existing) {
      const ownerAlive = isPidAlive(existing.pid);
      const healthy = ownerAlive ? await healthCheckBridge(existing.port, existing.token) : false;
      if (ownerAlive && healthy) {
        // Reuse — this window is a follower. Use the owner's port + token; don't bind a server.
        this._port = existing.port;
        // Replace our random token with the owner's so engines we spawn authenticate correctly.
        (this as { _token: string })._token = existing.token;
        this._isOwner = false;
        return this.info;
      }
      // Stale lockfile (owner dead or unhealthy) — clear it and claim ownership below.
      deleteLockfile();
    }

    // ── Phase 2: bind our own HTTP server and become the owner ──
    const server = http.createServer((req, res) => {
      this._handle(req, res).catch(err => {
        sendError(res, 500, 'UNKNOWN', err instanceof Error ? err.message : String(err), false);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
          this.server = server;
          this._isOwner = true;
          server.removeListener('error', reject);
          // Publish ourselves so other windows can find us.
          writeLockfile({ port: this._port, token: this._token, pid: process.pid, startedAt: new Date().toISOString() });
          resolve();
        } else {
          reject(new Error('LM bridge: failed to determine bound port'));
        }
      });
    });
    return this.info;
  }

  dispose(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Only the owner clears the lockfile so follower windows don't yank the entry out
    // from under each other. The owner's death also leaves a stale lockfile that the
    // next window will detect via PID check and clean up.
    if (this._isOwner) {
      deleteLockfile();
      this._isOwner = false;
    }
    this._port = 0;
  }

  // ── request handling ──────────────────────────────────────────────────────

  private async _handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Loopback-only check — reject any non-localhost peer.
    const remote = req.socket.remoteAddress ?? '';
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      sendError(res, 403, 'UNKNOWN', `LM bridge refused non-localhost peer: ${remote}`, false);
      return;
    }

    // Token gate — denies a hostile process that finds the loopback port.
    const presented = req.headers['x-bridge-token'];
    if (typeof presented !== 'string' || !timingSafeEqualStr(presented, this._token)) {
      sendError(res, 401, 'AUTH_FAILED', 'LM bridge: missing or invalid X-Bridge-Token', false);
      return;
    }

    if (req.method === 'GET' && req.url === '/lm/health') {
      const models = await safeListModels();
      sendJson(res, 200, {
        ok: models.length > 0,
        message: models.length > 0
          ? `${String(models.length)} chat model(s) available`
          : 'No vscode.lm chat models available — install GitHub Copilot Chat and sign in.',
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/lm/complete') {
      const body = await readJsonBody(req);
      if (!body) {
        sendError(res, 400, 'UNKNOWN', 'LM bridge: empty or invalid JSON body', false);
        return;
      }
      await this._handleComplete(body as LmCompleteRequest, res);
      return;
    }

    sendError(res, 404, 'UNKNOWN', `LM bridge: unknown route ${req.method ?? ''} ${req.url ?? ''}`, false);
  }

  private async _handleComplete(req: LmCompleteRequest, res: http.ServerResponse): Promise<void> {
    const vendor = req.vendor ?? DEFAULT_VENDOR;
    const family = req.family ?? DEFAULT_FAMILY;

    // Pick the requested model; fall back to first available chat model of the same vendor.
    let model: vscode.LanguageModelChat | undefined;
    try {
      const exact = await vscode.lm.selectChatModels({ vendor, family });
      model = exact[0];
      if (!model) {
        const anyOfVendor = await vscode.lm.selectChatModels({ vendor });
        model = anyOfVendor[0];
      }
      if (!model) {
        const any = await vscode.lm.selectChatModels();
        model = any[0];
      }
    } catch (err) {
      sendError(res, 503, 'MODEL_NOT_FOUND', `vscode.lm.selectChatModels failed: ${err instanceof Error ? err.message : String(err)}`, false);
      return;
    }
    if (!model) {
      sendError(res, 503, 'MODEL_NOT_FOUND',
        `No chat model available for vendor="${vendor}" family="${family}". Install GitHub Copilot Chat and sign in, then reload the window.`,
        false,
      );
      return;
    }

    // Build the chat message array. System prompt becomes the first User message because
    // vscode.lm doesn't expose a System role on the stable API surface.
    const msgs: vscode.LanguageModelChatMessage[] = [];
    if (req.systemPrompt) {
      msgs.push(vscode.LanguageModelChatMessage.User(req.systemPrompt));
    }
    for (const m of req.messages) {
      if (m.role === 'assistant') {
        msgs.push(vscode.LanguageModelChatMessage.Assistant(m.content));
      } else {
        // 'system' messages on the wire collapse to User — system prompt above already covered the canonical one.
        msgs.push(vscode.LanguageModelChatMessage.User(m.content));
      }
    }

    const cts = new vscode.CancellationTokenSource();
    res.once('close', () => { cts.cancel(); });

    try {
      const resp = await model.sendRequest(msgs, {}, cts.token);
      let content = '';
      for await (const chunk of resp.text) content += chunk;

      // vscode.lm doesn't surface usage; approximate from char counts.
      const approxIn = req.messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0)
        + Math.ceil((req.systemPrompt ?? '').length / 4);
      const approxOut = Math.ceil(content.length / 4);

      sendJson(res, 200, {
        content,
        inputTokens: approxIn,
        outputTokens: approxOut,
        model: model.id,
      } satisfies LmCompleteResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let code = 'UNKNOWN';
      let status = 500;
      let retryable = false;

      if (err instanceof vscode.LanguageModelError) {
        // Map known vscode.lm error codes to ProviderErrorCode.
        if (err.code === 'NoPermissions' || err.code === 'no-permissions') { code = 'AUTH_FAILED'; status = 401; }
        else if (err.code === 'Blocked' || err.code === 'blocked') { code = 'AUTH_FAILED'; status = 403; }
        else if (err.code === 'NotFound' || err.code === 'not-found') { code = 'MODEL_NOT_FOUND'; status = 404; }
        else if (/quota|rate/i.test(err.code) || /quota|rate/i.test(message)) { code = 'RATE_LIMITED'; status = 429; retryable = true; }
      }
      sendError(res, status, code, `vscode.lm error: ${message}`, retryable);
    } finally {
      cts.dispose();
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function safeListModels(): Promise<vscode.LanguageModelChat[]> {
  try { return await vscode.lm.selectChatModels(); } catch { return []; }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function sendError(
  res: http.ServerResponse, status: number, code: string, message: string, retryable: boolean,
): void {
  const body: LmErrorBody = { error: { code, message, retryable } };
  sendJson(res, status, body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(new Error(`LM bridge request body exceeds ${String(MAX_REQUEST_BYTES)} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve(null); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
    req.on('error', reject);
  });
}

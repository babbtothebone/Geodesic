import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import type { LmBridgeServerInfo } from './lm-bridge-server.js';
import { execSync } from 'child_process';

const PORT_PATTERN = /GEODE_ENGINE_PORT=(\d+)/;
const STARTUP_TIMEOUT_MS = 15_000;

// Heap size for the engine subprocess. medplum-scale repos can push past Node's default ceiling.
const ENGINE_MAX_OLD_SPACE_MB = 8192;

// Engine stderr is mirrored to this file so we can recover crash output (FATAL ERROR, V8 stack traces)
// after the process dies. Without this, Windows-level crashes (STATUS_STACK_BUFFER_OVERRUN etc.) leave
// no trace.
function engineStderrLogPath(): string {
  return path.join(os.homedir(), '.geodesic', 'engine-stderr.log');
}

export const ENGINE_STDERR_LOG_PATH = engineStderrLogPath();

export class EngineManager implements vscode.Disposable {
  private process: ChildProcess | null = null;
  private _port: number | null = null;
  private _startPromise: Promise<void> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _analysisInProgress = false;
  // Tail of the most recent stderr output. Used to enrich crash error messages with the
  // actual reason (e.g. "JavaScript heap out of memory") instead of just an exit code.
  private _stderrTail = '';
  private readonly _onStatusChange = new vscode.EventEmitter<string>();
  readonly onStatusChange = this._onStatusChange.event;
  private readonly _onCrash = new vscode.EventEmitter<{ exitCode: number; tail: string; logPath: string }>();
  readonly onCrash = this._onCrash.event;

  get port(): number | null { return this._port; }
  get stderrTail(): string { return this._stderrTail; }

  private findEngineScript(context: vscode.ExtensionContext): string | null {
    // 1. Bundled engine (VSIX distribution — esbuild output alongside extension bundle)
    const bundledPath = path.join(context.extensionPath, 'dist', 'engine-start.js');
    if (fs.existsSync(bundledPath)) return bundledPath;

    // 2. Workspace symlink (monorepo dev)
    const wsPath = path.join(context.extensionPath, '..', '..', 'node_modules', '@geodesic', 'engine', 'dist', 'server', 'start.js');
    if (fs.existsSync(wsPath)) return wsPath;

    // 3. Extension node_modules
    const extPath = path.join(context.extensionPath, 'node_modules', '@geodesic', 'engine', 'dist', 'server', 'start.js');
    if (fs.existsSync(extPath)) return extPath;

    return null;
  }

  private findNodeBinary(): string {
    try {
      const result = execSync('node --version', { encoding: 'utf8', timeout: 5000 });
      if (result.startsWith('v')) return 'node';
    } catch { /* fall through */ }
    // Common locations
    for (const bin of ['/usr/local/bin/node', '/usr/bin/node', 'C:\\Program Files\\nodejs\\node.exe']) {
      if (fs.existsSync(bin)) return bin;
    }
    return 'node';
  }

  private _bridgeInfo: LmBridgeServerInfo | null = null;

  async start(context: vscode.ExtensionContext, bridgeInfo?: LmBridgeServerInfo): Promise<void> {
    if (this.process) return;
    if (this._startPromise) return this._startPromise;
    if (bridgeInfo) this._bridgeInfo = bridgeInfo;
    this._startPromise = this._doStart(context).finally(() => { this._startPromise = null; });
    return this._startPromise;
  }

  private async _doStart(context: vscode.ExtensionContext): Promise<void> {
    this._onStatusChange.fire('Starting engine…');

    const scriptPath = this.findEngineScript(context);
    if (!scriptPath) {
      const choice = await vscode.window.showErrorMessage(
        'Geodesic engine not found. Install it via npm?',
        'Install Now',
        'Cancel',
      );
      if (choice === 'Install Now') {
        await this.installEngine();
        await this.start(context);
      }
      return;
    }

    // Open the stderr log in append mode so successive runs accumulate.
    let stderrLogStream: fs.WriteStream | null = null;
    try {
      fs.mkdirSync(path.dirname(ENGINE_STDERR_LOG_PATH), { recursive: true });
      stderrLogStream = fs.createWriteStream(ENGINE_STDERR_LOG_PATH, { flags: 'a' });
      stderrLogStream.write(`\n=== engine start ${new Date().toISOString()} ===\n`);
    } catch { /* non-fatal — we still capture in memory */ }

    return new Promise((resolve, reject) => {
      const node = this.findNodeBinary();
      // --max-old-space-size raises V8's heap ceiling so harvests of large monorepos
      // (medplum-scale, ~5K+ files) don't crash the engine with STATUS_STACK_BUFFER_OVERRUN.
      const proc = spawn(node, [`--max-old-space-size=${String(ENGINE_MAX_OLD_SPACE_MB)}`, scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(this._bridgeInfo ? {
            GEODESIC_LM_BRIDGE_PORT: String(this._bridgeInfo.port),
            GEODESIC_LM_BRIDGE_TOKEN: this._bridgeInfo.token,
          } : {}),
        },
      });

      this.process = proc;
      this._stderrTail = '';

      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('Engine failed to start within timeout'));
      }, STARTUP_TIMEOUT_MS);

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const match = PORT_PATTERN.exec(text);
        if (match?.[1]) {
          this._port = parseInt(match[1], 10);
          clearTimeout(timeout);
          this._onStatusChange.fire(`Engine running on port ${String(this._port)}`);
          this._startHeartbeat(context);
          resolve();
        }
      });

      let stderrBuf = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // Mirror to disk first so a hard crash mid-line still leaves a record.
        stderrLogStream?.write(text);
        // Keep last ~8KB in memory for crash diagnostics in toasts.
        this._stderrTail = (this._stderrTail + text).slice(-8192);

        stderrBuf += text;
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          // Suppress analysis-internal logs — only surface real engine lifecycle errors.
          if (trimmed && !trimmed.startsWith('[geodesic]')) {
            this._onStatusChange.fire(`Engine: ${trimmed}`);
          }
        }
      });

      proc.on('exit', (code) => {
        this.process = null;
        this._port = null;
        clearTimeout(timeout);
        this._stopHeartbeat();
        this._onStatusChange.fire('Engine stopped');

        try { stderrLogStream?.write(`=== engine exit code=${String(code)} ${new Date().toISOString()} ===\n`); } catch { /* ignore */ }
        try { stderrLogStream?.end(); } catch { /* ignore */ }

        if (code !== 0 && code !== null) {
          // Fire the crash event so listeners (e.g. an in-flight analysis runner)
          // can surface a useful error instead of an opaque ECONNRESET.
          this._onCrash.fire({ exitCode: code, tail: this._stderrTail, logPath: ENGINE_STDERR_LOG_PATH });

          const reason = extractCrashReason(this._stderrTail) ?? `exit code ${String(code)}`;
          void vscode.window.showErrorMessage(
            `Geodesic engine crashed: ${reason}`,
            'Open Crash Log',
            'Restart',
          ).then(async choice => {
            if (choice === 'Restart') await this.start(context);
            if (choice === 'Open Crash Log') {
              await vscode.window.showTextDocument(vscode.Uri.file(ENGINE_STDERR_LOG_PATH));
            }
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  setAnalysisInProgress(inProgress: boolean): void {
    this._analysisInProgress = inProgress;
  }

  private _startHeartbeat(context: vscode.ExtensionContext): void {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      const port = this._port;
      if (!port) return;
      // Skip kill-and-restart during active analysis — harvest() blocks the event loop
      // and the engine will look unresponsive even though it is healthy.
      if (this._analysisInProgress) return;
      void fetch(`http://127.0.0.1:${String(port)}/health`, { signal: AbortSignal.timeout(5000) })
        .catch(() => {
          this._onStatusChange.fire('Engine not responding — restarting…');
          this.stop();
          void this.start(context);
        });
    }, 30_000);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private async installEngine(): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Installing Geodesic engine…', cancellable: false },
      () => new Promise<void>((resolve, reject) => {
        const proc = spawn('npm', ['install', '-g', '@geodesic/cli'], { shell: true, stdio: 'inherit' });
        proc.on('exit', code => {
          if (code === 0) resolve();
          else reject(new Error(`npm install failed with code ${String(code)}`));
        });
        proc.on('error', reject);
      }),
    );
  }

  async restart(context: vscode.ExtensionContext): Promise<void> {
    this.stop();
    await this.start(context);
  }

  stop(): void {
    this._stopHeartbeat();
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this._port = null;
    }
  }

  dispose(): void {
    this.stop();
    this._onStatusChange.dispose();
    this._onCrash.dispose();
  }
}

// Pulls the most informative line out of a Node stderr tail, in priority order:
//   1. V8 fatal errors ("FATAL ERROR: ... JavaScript heap out of memory")
//   2. Uncaught exceptions ("[geodesic] uncaught exception: ...")
//   3. Unhandled rejections ("[geodesic] unhandled rejection: ...")
//   4. Last non-empty line as a last resort.
function extractCrashReason(tail: string): string | null {
  if (!tail) return null;
  const lines = tail.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.includes('FATAL ERROR:')) {
      // V8 fatal errors are usually one line, sometimes followed by "out of memory" on the next line.
      // Combine the marker line with anything else mentioning "out of memory" or "Allocation failed".
      const oom = lines.find(l => /(out of memory|Allocation failed)/i.test(l));
      return oom ? `${line} — ${oom}` : line;
    }
  }

  for (const line of lines) {
    if (line.startsWith('[geodesic] uncaught exception:')) return line.replace(/^\[geodesic\]\s*/, '');
    if (line.startsWith('[geodesic] unhandled rejection:')) return line.replace(/^\[geodesic\]\s*/, '');
  }

  return lines[lines.length - 1] ?? null;
}

// filepath: /Users/nicholasbabb/Desktop/Builds/geodesic-main/packages/vscode-ext/src/preflight.ts
/**
 * Preflight dependency checker.
 *
 * Runs once on extension activation (and again on demand) to detect missing
 * external dependencies *before* the user kicks off an analysis. Each check
 * surfaces an actionable toast — Install / Sign In / Reload — and is
 * individually suppressible via the "Don't show again" button so seasoned
 * users aren't nagged.
 *
 * Checks performed:
 *   1. Node.js on PATH                    — required to spawn the engine subprocess.
 *   2. GitHub Copilot Chat extension      — required by the `copilot` provider.
 *   3. Copilot sign-in / chat model       — required for the bridge to return content.
 *   4. LM bridge server health            — required for the engine to call vscode.lm.
 *
 * Checks 2-4 are only enforced when the user has selected the `copilot`
 * provider in ~/.geodesic/config.json. Users on Anthropic/OpenAI/Ollama
 * don't see Copilot-related prompts.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { LmBridgeServer } from './lm-bridge-server.js';

const COPILOT_CHAT_EXT_ID = 'GitHub.copilot-chat';
const SUPPRESS_PREFIX = 'geodesic.preflight.suppress.';

interface PreflightOptions {
  /** Path to the user's config file (~/.geodesic/config.json). */
  configPath: string;
  /** Bridge instance — only checked if Copilot is the selected provider. */
  bridge: LmBridgeServer | null;
  /** Global state used to remember "Don't show again" choices across sessions. */
  globalState: vscode.Memento;
}

interface CheckResult {
  id: string;
  ok: boolean;
  message?: string;
  actions?: Array<{ label: string; run: () => Promise<void> | Thenable<unknown> | undefined }>;
}

export async function runPreflight(opts: PreflightOptions): Promise<CheckResult[]> {
  const provider = readProvider(opts.configPath);
  const results: CheckResult[] = [];

  results.push(checkNode());

  // Copilot-specific checks only run when the user has actually selected Copilot.
  // Users on Anthropic/OpenAI/Ollama/etc. don't need GitHub Copilot Chat installed.
  if (provider === 'copilot' || provider === null) {
    results.push(checkCopilotChatExtension());
    // Chat-model check is async and only meaningful if the extension is present.
    const lastIsCopilotExt = results[results.length - 1];
    if (lastIsCopilotExt?.ok) {
      results.push(await checkCopilotSignedIn());
    }
    if (opts.bridge) {
      results.push(await checkLmBridge(opts.bridge));
    }
  }

  // Surface each failed check as a toast — but skip ones the user has muted.
  for (const r of results) {
    if (r.ok) continue;
    const suppressKey = `${SUPPRESS_PREFIX}${r.id}`;
    if (opts.globalState.get<boolean>(suppressKey)) continue;
    void surfaceFailure(r, opts.globalState, suppressKey);
  }

  return results;
}

// ── individual checks ─────────────────────────────────────────────────────

function checkNode(): CheckResult {
  // The engine is spawned as a Node subprocess, so a `node` binary must exist.
  // We try `node --version` first, then the usual install locations.
  try {
    const out = execSync('node --version', { encoding: 'utf8', timeout: 5000 }).trim();
    if (out.startsWith('v')) {
      return { id: 'node', ok: true, message: `Node ${out} detected` };
    }
  } catch { /* fall through */ }

  for (const bin of ['/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/node', 'C:\\Program Files\\nodejs\\node.exe']) {
    if (fs.existsSync(bin)) return { id: 'node', ok: true, message: `Node found at ${bin}` };
  }

  return {
    id: 'node',
    ok: false,
    message: 'Geodesic requires Node.js (18+) but no `node` binary was found on PATH. The engine cannot start.',
    actions: [
      {
        label: 'Install Node.js',
        run: () => vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/en/download')).then(() => undefined),
      },
    ],
  };
}

function checkCopilotChatExtension(): CheckResult {
  const ext = vscode.extensions.getExtension(COPILOT_CHAT_EXT_ID);
  if (ext) return { id: 'copilot-chat-ext', ok: true, message: 'GitHub Copilot Chat extension installed' };

  return {
    id: 'copilot-chat-ext',
    ok: false,
    message: 'The `copilot` provider needs the GitHub Copilot Chat extension, but it is not installed.',
    actions: [
      {
        label: 'Install',
        run: async () => {
          // VS Code's built-in install command — opens the marketplace pane and installs.
          await vscode.commands.executeCommand('workbench.extensions.installExtension', COPILOT_CHAT_EXT_ID);
          void vscode.window.showInformationMessage('GitHub Copilot Chat installed. Reload the window to enable the bridge.', 'Reload')
            .then(c => { if (c === 'Reload') void vscode.commands.executeCommand('workbench.action.reloadWindow'); });
        },
      },
      {
        label: 'Switch Provider',
        run: () => vscode.commands.executeCommand('geodesic.configureProvider').then(() => undefined),
      },
    ],
  };
}

async function checkCopilotSignedIn(): Promise<CheckResult> {
  try {
    const models = await vscode.lm.selectChatModels();
    if (models.length > 0) {
      return { id: 'copilot-signin', ok: true, message: `${String(models.length)} chat model(s) available` };
    }
  } catch (err) {
    return {
      id: 'copilot-signin',
      ok: false,
      message: `vscode.lm.selectChatModels failed: ${err instanceof Error ? err.message : String(err)}`,
      actions: [{ label: 'Reload Window', run: () => vscode.commands.executeCommand('workbench.action.reloadWindow').then(() => undefined) }],
    };
  }

  return {
    id: 'copilot-signin',
    ok: false,
    message: 'GitHub Copilot Chat is installed but no chat models are available. You may need to sign in to GitHub or activate a Copilot subscription.',
    actions: [
      {
        label: 'Sign In',
        run: () => vscode.commands.executeCommand('github.copilot.signIn').then(() => undefined, () => {
          // Fallback for older Copilot Chat versions that don't expose `github.copilot.signIn`.
          void vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/copilot'));
        }),
      },
    ],
  };
}

async function checkLmBridge(bridge: LmBridgeServer): Promise<CheckResult> {
  if (!bridge.port) {
    return {
      id: 'lm-bridge',
      ok: false,
      message: 'LM bridge server is not listening. The Copilot provider will be unavailable.',
      actions: [{ label: 'Reload Window', run: () => vscode.commands.executeCommand('workbench.action.reloadWindow').then(() => undefined) }],
    };
  }
  // Hit our own /lm/health to confirm the loopback round-trip works (catches firewall / VPN issues).
  try {
    const resp = await fetch(`http://127.0.0.1:${String(bridge.port)}/lm/health`, {
      headers: { 'X-Bridge-Token': bridge.token },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) return { id: 'lm-bridge', ok: true, message: `LM bridge healthy on :${String(bridge.port)}` };
    return {
      id: 'lm-bridge',
      ok: false,
      message: `LM bridge returned HTTP ${String(resp.status)} on health check.`,
    };
  } catch (err) {
    return {
      id: 'lm-bridge',
      ok: false,
      message: `LM bridge unreachable on 127.0.0.1:${String(bridge.port)}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── presentation ──────────────────────────────────────────────────────────

async function surfaceFailure(result: CheckResult, globalState: vscode.Memento, suppressKey: string): Promise<void> {
  const buttons = [
    ...(result.actions ?? []).map(a => a.label),
    "Don't show again",
  ];
  const choice = await vscode.window.showWarningMessage(`Geodesic: ${result.message ?? result.id}`, ...buttons);
  if (!choice) return;
  if (choice === "Don't show again") {
    await globalState.update(suppressKey, true);
    return;
  }
  const action = result.actions?.find(a => a.label === choice);
  if (action) await action.run();
}

// ── helpers ───────────────────────────────────────────────────────────────

function readProvider(configPath: string): string | null {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { provider?: string };
    return raw.provider ?? null;
  } catch {
    return null;
  }
}

/** Lets the user reset all suppressed warnings via a command. */
export async function resetSuppressedWarnings(globalState: vscode.Memento): Promise<void> {
  const keys = globalState.keys().filter(k => k.startsWith(SUPPRESS_PREFIX));
  for (const k of keys) await globalState.update(k, undefined);
}

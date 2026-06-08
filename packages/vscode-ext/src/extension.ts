import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EngineManager, ENGINE_STDERR_LOG_PATH } from './engine-manager.js';
import { LmBridgeServer } from './lm-bridge-server.js';
import { EngineClient } from './engine-client.js';
import { ExtensionState } from './state.js';
import { SidebarProvider } from './sidebar-provider.js';
import { ResultsPanel } from './results-panel.js';
import { runPreflight, resetSuppressedWarnings } from './preflight.js';
import type { GeodesicConfig } from '@geodesic/types';

import { GEODESIC_VERSION } from '@geodesic/engine';
export const EXTENSION_VERSION = GEODESIC_VERSION;

const CONFIG_PATH = path.join(os.homedir(), '.geodesic', 'config.json');

function saveConfig(provider: string, apiKey: string): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existing = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
    : {};

  const config: Record<string, unknown> = {
    ...existing,
    provider,
    apiKey: apiKey || undefined,
    analystId: existing['analystId'] ?? `${os.userInfo().username}@${os.hostname()}`,
  };

  if (!apiKey) delete config['apiKey'];
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function readConfigInfo(): { provider: string; hasApiKey: boolean } | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<GeodesicConfig>;
    if (!raw.provider) return null;
    return { provider: raw.provider, hasApiKey: !!raw.apiKey };
  } catch {
    return null;
  }
}

function readCrystalConfig(): { repoUrl: string; hasToken: boolean } {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { repoUrl: '', hasToken: false };
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<GeodesicConfig>;
    return { repoUrl: raw.crystalStoreRepo ?? '', hasToken: !!raw.crystalStoreToken };
  } catch {
    return { repoUrl: '', hasToken: false };
  }
}

function saveCrystalConfig(repoUrl: string, token: string): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existing: Record<string, unknown> = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
    : {};
  if (repoUrl) existing['crystalStoreRepo'] = repoUrl;
  else delete existing['crystalStoreRepo'];
  if (token) existing['crystalStoreToken'] = token;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), 'utf8');
}

function clearCrystalConfig(): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existing: Record<string, unknown> = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>
    : {};
  delete existing['crystalStoreRepo'];
  delete existing['crystalStoreToken'];
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), 'utf8');
}

export function activate(context: vscode.ExtensionContext): void {
  const state = new ExtensionState(context.globalState);
  const engineManager = new EngineManager();
  const resultsPanel = new ResultsPanel();

  // LM bridge — constructed early so preflight commands can reference it. Started further down
  // (after autoStart check) so its port can be injected via env vars at spawn time.
  const lmBridge = new LmBridgeServer();
  context.subscriptions.push(lmBridge);

  let engineClient: EngineClient | null = null;

  function getClient(): EngineClient | null {
    return engineClient;
  }

  const sidebarProvider = new SidebarProvider(context, state, engineManager, {
    onRunAnalysis: (paths) => { runAnalysis(paths); },
    onConfigureProvider: (provider, apiKey) => {
      saveConfig(provider, apiKey);
      return Promise.resolve();
    },
    onSaveCrystalStore: (repoUrl, token) => { saveCrystalConfig(repoUrl, token); },
    onClearCrystalStore: () => { clearCrystalConfig(); },
    getClient,
    getConfigInfo: readConfigInfo,
    getCrystalConfig: readCrystalConfig,
  });

  // Register sidebar webview view
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('geodesic.repos', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('geodesic.analyze', () => {
      const repos = state.getRepos();
      if (repos.length === 0) {
        void vscode.window.showWarningMessage('No repositories added. Use Geodesic sidebar to add a repository first.');
        return;
      }
      runAnalysis(repos.map(r => r.path));
    }),

    vscode.commands.registerCommand('geodesic.addRepo', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Add Repository',
      });
      if (uris?.[0]) {
        await state.addRepo(uris[0].fsPath);
        void vscode.window.showInformationMessage(`Added: ${uris[0].fsPath}`);
      }
    }),

    vscode.commands.registerCommand('geodesic.removeRepo', async () => {
      const repos = state.getRepos();
      if (repos.length === 0) {
        void vscode.window.showInformationMessage('No repositories to remove.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        repos.map(r => ({ label: r.label, description: r.path, path: r.path })),
        { placeHolder: 'Select repository to remove' },
      );
      if (pick) {
        await state.removeRepo(pick.path);
        void vscode.window.showInformationMessage(`Removed: ${pick.path}`);
      }
    }),

    vscode.commands.registerCommand('geodesic.configureProvider', async () => {
      const provider = await vscode.window.showQuickPick(
        ['copilot', 'anthropic', 'openai', 'gemini', 'azure', 'ollama'],
        { placeHolder: 'Select AI provider' },
      );
      if (!provider) return;

      const apiKey = await vscode.window.showInputBox({
        prompt: `API key for ${provider} (leave empty for copilot/ollama)`,
        password: true,
        placeHolder: (provider === 'ollama' || provider === 'copilot') ? '(no key needed)' : 'sk-…',
      });
      if (apiKey === undefined) return;

      saveConfig(provider, apiKey);
      void vscode.window.showInformationMessage(`Provider configured: ${provider}`);
      await sidebarProvider.pushState();
    }),

    vscode.commands.registerCommand('geodesic.syncCrystals', async () => {
      const client = getClient();
      if (!client) {
        void vscode.window.showWarningMessage('Engine not running.');
        return;
      }
      try {
        const result = await client.syncCrystals();
        void vscode.window.showInformationMessage(result.message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Sync failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('geodesic.openAttestation', () => {
      const attestationPath = path.join(os.homedir(), 'geodesic-attestation.jsonl');
      if (!fs.existsSync(attestationPath)) {
        void vscode.window.showInformationMessage('No attestation chain found. Run an analysis first.');
        return;
      }
      void vscode.window.showTextDocument(vscode.Uri.file(attestationPath));
    }),

    vscode.commands.registerCommand('geodesic.runPreflight', async () => {
      // Forces all checks to display, even ones the user has muted with "Don't show again",
      // by handing runPreflight a Memento facade that always reports "not suppressed".
      const memento: vscode.Memento = {
        keys: () => context.globalState.keys(),
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
        update: (key: string, value: unknown) => context.globalState.update(key, value),
      };
      const results = await runPreflight({
        configPath: CONFIG_PATH,
        bridge: lmBridge,
        globalState: memento,
      });
      const failed = results.filter(r => !r.ok);
      if (failed.length === 0) {
        void vscode.window.showInformationMessage(
          `Geodesic preflight: all ${String(results.length)} dependency check(s) passed.`,
        );
      }
    }),

    vscode.commands.registerCommand('geodesic.resetWarnings', async () => {
      await resetSuppressedWarnings(context.globalState);
      void vscode.window.showInformationMessage(
        'Geodesic: suppressed dependency warnings have been reset.',
      );
    }),
  );

  // Re-push state whenever the workspace folders change (user opens/closes a folder)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sidebarProvider.pushState();
    }),
  );

  // Keep engineClient in sync with the engine port on every status change (handles restarts)
  context.subscriptions.push(
    engineManager.onStatusChange(() => {
      const port = engineManager.port;
      if (port) {
        engineClient = new EngineClient(port);
      } else {
        engineClient = null;
      }
      void sidebarProvider.pushState();
    }),
  );

  // Start engine on activation
  const autoStart = vscode.workspace.getConfiguration('geodesic').get<boolean>('autoStartEngine', true);
  if (autoStart) {
    void (async () => {
      let bridgeInfo;
      try {
        bridgeInfo = await lmBridge.start();
      } catch (err) {
        // Non-fatal — only the Copilot provider needs the bridge. Anthropic/OpenAI still work.
        // But the user must know: silently degrading to "Copilot unavailable" is the #1 source
        // of confused bug reports.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[geodesic] LM bridge failed to start: ${msg}`);
        void vscode.window.showWarningMessage(
          `Geodesic: LM bridge failed to start (${msg}). The Copilot provider will be unavailable; other providers (Anthropic, OpenAI, Ollama) still work.`,
          'Switch Provider',
        ).then(c => {
          if (c === 'Switch Provider') void vscode.commands.executeCommand('geodesic.configureProvider');
        });
      }
      try {
        await engineManager.start(context, bridgeInfo);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Geodesic engine failed to start: ${msg}`);
      }

      // Preflight runs *after* engine + bridge have had a chance to start, so the bridge
      // health check is meaningful. Failures surface as actionable toasts; each one is
      // individually suppressible via "Don't show again" (stored in globalState).
      void runPreflight({
        configPath: CONFIG_PATH,
        bridge: lmBridge,
        globalState: context.globalState,
      });
    })();
  }

  function runAnalysis(repoPaths: string[]): void {
    const client = getClient();
    if (!client) {
      void sidebarProvider.clearProgress();
      void vscode.window.showErrorMessage('Geodesic engine is not running. Please wait for it to start.');
      return;
    }

    for (const repoPath of repoPaths) {
      void runSingleAnalysis(client, repoPath);
    }
  }

  async function runSingleAnalysis(client: EngineClient, repoPath: string): Promise<void> {
    engineManager.setAnalysisInProgress(true);
    // Capture an engine crash that happens while we're polling — without this we get
    // an opaque ECONNRESET. The crash event fires before the HTTP poll fails.
    // Held in an object so the assignment inside the onCrash callback stays visible to the type
    // checker in the catch block below — a bare `let` gets narrowed back to `null` there.
    const crash: { reason: string | null } = { reason: null };
    const crashSub = engineManager.onCrash(({ exitCode, tail }) => {
      const firstLine = tail.split('\n').map(s => s.trim()).filter(Boolean).pop() ?? '';
      crash.reason = firstLine || `engine exited with code ${String(exitCode)}`;
    });
    try {
      const { jobId } = await client.startAnalysis(repoPath);

      await client.pollJob(jobId, (rawJob) => {
        const j = rawJob as { progress?: unknown };
        void sidebarProvider.updateProgress(j.progress);
      });

      const finalJob = await client.getJob(jobId);
      const job = finalJob as { progress: { status: string; stage: string; phiZoneCount: number; crystalMatch: string | null; crystalMatchScore: number | null }; result: { synthesis: { skillFile: { meta: { repo: string; analyzedAt: string; analysisDurationMs: number }; phiZones: Array<{ file: string; lineStart: number; lineEnd: number; phiFieldCount: number; protectionMissing: string[] }> }; gapReport: { repoName: string; overallScore: number; overallGrade: string; dimensions: Array<{ dimension: string; score: number; grade: string; active: boolean; findings: Array<{ severity: string; description: string; file: string; lineStart: number; lineEnd: number; detail: string; fix: string; deduction: number }> }>; uncertainDetections: Array<{ file: string; lineStart: number; lineEnd: number; trigger: string; confidencePct: number; recommendedAction: string }> }; architectureMapMarkdown: string }; artifactPaths: { architectureMap: string; skillFileJson: string; skillFileMd: string; gapReport: string }; fingerprint: string }; error: string | null };

      await sidebarProvider.clearProgress();

      // pollJob resolves only on 'complete', so result is guaranteed here
      resultsPanel.open(job, context);
      const gr = job.result.synthesis.gapReport;

      const totalSeconds = Math.round(job.result.synthesis.skillFile.meta.analysisDurationMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const elapsed = minutes > 0
        ? `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`
        : `${String(seconds)}s`;

      void vscode.window.showInformationMessage(
        `Geodesic analyzed ${gr.repoName} in ${elapsed} — ${String(gr.overallScore)}/100 (${gr.overallGrade})`,
        'View Results',
      ).then(choice => {
        if (choice === 'View Results') {
          resultsPanel.open(job, context);
        }
      });
    } catch (err) {
      await sidebarProvider.clearProgress();
      const rawMsg = err instanceof Error ? err.message : String(err);

      if (crash.reason !== null) {
        // Engine crashed mid-analysis — the engine-manager already showed a "crash" toast with
        // a "Open Crash Log" button. Show a concise analysis-failed toast that matches.
        void vscode.window.showErrorMessage(
          `Analysis aborted — engine crashed: ${crash.reason}`,
          'Open Crash Log',
        ).then(choice => {
          if (choice === 'Open Crash Log') {
            void vscode.window.showTextDocument(vscode.Uri.file(ENGINE_STDERR_LOG_PATH));
          }
        });
      } else if (/ECONNRESET|ECONNREFUSED|socket hang up/i.test(rawMsg)) {
        // Connection died but we didn't see a crash event — engine may be wedged.
        void vscode.window.showErrorMessage(
          `Analysis failed: lost connection to engine. See ${ENGINE_STDERR_LOG_PATH} for details.`,
          'Open Crash Log',
        ).then(choice => {
          if (choice === 'Open Crash Log') {
            void vscode.window.showTextDocument(vscode.Uri.file(ENGINE_STDERR_LOG_PATH));
          }
        });
      } else {
        void vscode.window.showErrorMessage(`Analysis failed: ${rawMsg}`);
      }
    } finally {
      engineManager.setAnalysisInProgress(false);
      crashSub.dispose();
    }
  }

  context.subscriptions.push(state, engineManager, resultsPanel);
}

export function deactivate(): void {
  // Engine manager is disposed via context.subscriptions
}

import * as vscode from 'vscode';
import type { ExtensionState } from './state.js';
import type { EngineManager } from './engine-manager.js';
import type { EngineClient } from './engine-client.js';

export type SidebarMessage =
  | { type: 'addRepo' }
  | { type: 'removeRepo'; path: string }
  | { type: 'runAnalysis'; paths: string[] }
  | { type: 'configureProvider'; provider: string; apiKey: string }
  | { type: 'testConnection' }
  | { type: 'syncCrystals' }
  | { type: 'saveCrystalStore'; repoUrl: string; token: string }
  | { type: 'clearCrystalStore' }
  | { type: 'useWorkspace'; path: string; name: string }
  | { type: 'scanWorkspace'; path: string; name: string }
  | { type: 'openExternal'; url: string }
  | { type: 'setupDocs'; repoPath: string }
  | { type: 'openDocsFolder'; folderPath: string }
  | { type: 'ready' };

export interface SidebarCallbacks {
  onRunAnalysis: (paths: string[]) => void;
  onConfigureProvider: (provider: string, apiKey: string) => Promise<void>;
  onSaveCrystalStore: (repoUrl: string, token: string) => void;
  onClearCrystalStore: () => void;
  getClient: () => EngineClient | null;
  getConfigInfo: () => { provider: string; hasApiKey: boolean } | null;
  getCrystalConfig: () => { repoUrl: string; hasToken: boolean };
}

function getSidebarHtml(webview: vscode.Webview, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Geodesic</title>
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); padding: 0 8px 16px; }

  /* Typography */
  h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-sideBarSectionHeader-foreground); margin: 14px 0 6px; padding-top: 6px; border-top: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15)); }
  h3:first-child { border-top: none; margin-top: 8px; }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 10px; font-size: 12px; cursor: pointer; border-radius: 2px; font-family: inherit; border: none; outline: none; transition: opacity 0.1s; }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-ghost { background: none; border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35)); color: var(--vscode-foreground); }
  .btn-ghost:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .btn-link { background: none; border: none; color: var(--vscode-textLink-foreground); font-size: 11px; cursor: pointer; padding: 0; text-decoration: underline; }
  .btn-link:hover { color: var(--vscode-textLink-activeForeground); }
  .btn-icon { background: none; border: none; color: var(--vscode-foreground); opacity: 0.55; padding: 2px 4px; cursor: pointer; font-size: 13px; line-height: 1; }
  .btn-icon:hover { opacity: 1; }
  .full-width { width: 100%; }

  /* Start Scan — prominent primary CTA */
  .scan-btn {
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.03em;
    margin-top: 6px;
    border-radius: 3px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
  }
  .scan-btn:hover:not(:disabled) { filter: brightness(1.08); }

  /* Forms */
  select, input[type=text], input[type=password] {
    width: 100%; padding: 4px 7px; font-size: 12px; font-family: inherit;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35)); border-radius: 2px;
  }
  select:focus, input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  label { display: block; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
  .label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
  .form-row { margin-bottom: 8px; }
  .input-row { display: flex; gap: 4px; align-items: center; }
  .input-row input { flex: 1; }

  /* Cards / Step cards */
  .step-card { background: var(--vscode-textBlockQuote-background); border-radius: 3px; padding: 10px 10px 12px; margin-bottom: 8px; }
  .step-card.locked { opacity: 0.45; pointer-events: none; }
  .step-header { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
  .step-num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 700; background: var(--vscode-button-background); color: var(--vscode-button-foreground); flex-shrink: 0; }
  .step-num.done { background: var(--vscode-charts-green, #4caf50); }
  .step-title { font-size: 12px; font-weight: 600; }

  /* Status / Feedback */
  .status-bar { font-size: 10px; color: var(--vscode-descriptionForeground); padding: 4px 6px; background: var(--vscode-textBlockQuote-background); border-radius: 2px; margin-bottom: 8px; word-break: break-word; }
  .feedback { font-size: 11px; margin-top: 6px; padding: 4px 7px; border-radius: 2px; }
  .feedback.success { color: var(--vscode-charts-green, #4caf50); background: rgba(76,175,80,0.1); }
  .feedback.error { color: var(--vscode-charts-red, #f44336); background: rgba(244,67,54,0.1); }
  .feedback.info { color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
  .hidden { display: none; }

  /* Config summary bar */
  .config-summary { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 5px 0; }
  .check { color: var(--vscode-charts-green, #4caf50); font-size: 13px; }
  .dot { color: var(--vscode-descriptionForeground); }
  .muted { color: var(--vscode-descriptionForeground); }

  /* Workspace buttons */
  .workspace-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 10px; margin-bottom: 5px; text-align: left; }
  .workspace-btn .ws-name { font-size: 12px; font-weight: 600; }
  .workspace-btn .ws-path { font-size: 10px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }

  /* Repo list */
  .repo-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15)); }
  .repo-label { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 155px; }
  .repo-path { font-size: 10px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 155px; }
  .empty-state { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 6px 0; }

  /* Progress */
  .progress-section { background: var(--vscode-textBlockQuote-background); border-radius: 3px; padding: 10px 10px 12px; margin-top: 10px; border-left: 2px solid var(--vscode-progressBar-background); }
  .progress-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .progress-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-progressBar-background); }
  .progress-elapsed { font-size: 10px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .progress-bar-track { height: 2px; background: rgba(128,128,128,0.2); border-radius: 2px; margin-bottom: 10px; overflow: hidden; }
  .progress-bar-fill { height: 100%; background: var(--vscode-progressBar-background); border-radius: 2px; transition: width 0.5s ease; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }

  /* Phase tree */
  .phase-tree { display: flex; flex-direction: column; gap: 2px; }
  .phase { display: flex; flex-direction: column; }
  .phase-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 2px; cursor: pointer; user-select: none; }
  .phase-row:hover { background: var(--vscode-list-hoverBackground); }
  .phase-glyph { width: 12px; text-align: center; font-size: 11px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .phase-glyph.running { color: var(--vscode-progressBar-background); animation: pulse 1.2s ease-in-out infinite; }
  .phase-glyph.spinning { display: inline-block; animation: spin 1.2s linear infinite; }
  .phase-name { font-size: 11px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .phase-name.pending { color: var(--vscode-descriptionForeground); font-weight: 500; }
  .phase-name.failed { color: var(--vscode-charts-red, #f44336); }
  .phase-badge { font-size: 9px; color: var(--vscode-descriptionForeground); padding: 1px 5px; border-radius: 2px; background: rgba(128,128,128,0.15); font-variant-numeric: tabular-nums; }
  .phase-duration { font-size: 9px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .phase-caret { font-size: 9px; color: var(--vscode-descriptionForeground); width: 10px; text-align: center; flex-shrink: 0; }

  .subtask-list { display: flex; flex-direction: column; gap: 1px; padding: 2px 0 4px 22px; border-left: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15)); margin-left: 9px; }
  .subtask { display: flex; align-items: flex-start; gap: 5px; font-size: 10px; line-height: 1.4; padding: 1px 4px; }
  .subtask-glyph { width: 10px; text-align: center; flex-shrink: 0; font-size: 10px; }
  .subtask-glyph.complete { color: var(--vscode-charts-green, #4caf50); }
  .subtask-glyph.running { color: var(--vscode-progressBar-background); animation: pulse 1.2s ease-in-out infinite; }
  .subtask-glyph.pending { color: var(--vscode-descriptionForeground); opacity: 0.6; }
  .subtask-glyph.failed { color: var(--vscode-charts-red, #f44336); }
  .subtask-label { color: var(--vscode-foreground); flex: 1; min-width: 0; word-break: break-word; }
  .subtask-label.pending { color: var(--vscode-descriptionForeground); }
  .subtask-detail { color: var(--vscode-descriptionForeground); font-size: 9px; margin-left: 4px; }
  .subtask-duration { font-size: 9px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; flex-shrink: 0; margin-left: 4px; }

  /* Crystal chip */
  .crystal-row { display: flex; align-items: center; justify-content: space-between; }
  .crystal-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }

  /* Divider */
  .divider { border: none; border-top: 1px solid var(--vscode-sideBar-border, rgba(128,128,128,0.15)); margin: 10px 0; }

  /* Provider hint */
  .provider-hint { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 4px; }

  /* Repo select actions — scan + change repo stack */
  .repo-select-actions { display: flex; flex-direction: column; gap: 20px; width: 100%; }

  /* Config form save row */
  .config-save-row { display: flex; gap: 6px; margin-top: 10px; }
  .config-save-row .save-btn { flex: 1; padding: 6px; }
  .config-save-row .test-btn { padding: 6px 10px; }

  /* Config step small buttons */
  .cancel-btn { margin-top: 8px; font-size: 11px; }
  .key-link { font-size: 10px; }

  /* Workspace detected label */
  .ws-label { margin-bottom: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* Change Repo / browse button sizing */
  .change-repo-btn { font-size: 11px; padding: 6px; }
  .browse-repo-btn { padding: 7px; }

  /* Config summary edit link */
  .edit-link { margin-left: auto; }

  /* Warning inline text */
  .warn-inline { color: var(--vscode-charts-yellow, #ffc107); }

  /* Repo list add row */
  .add-repo-row { margin-top: 6px; }
  .add-repo-btn { font-size: 11px; padding: 4px 12px; }

  /* Progress detail lines */
  .phi-warning { font-size: 10px; color: var(--vscode-charts-yellow, #ffc107); margin-top: 3px; }
  .crystal-info { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }

  /* Sync button */
  .sync-btn { font-size: 11px; padding: 3px 8px; }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  let state = {
    repos: [],
    workspaceFolders: [],
    engineStatus: 'Starting engine…',
    crystalCount: 0,
    running: false,
    progress: null,
    hasConfig: false,
    provider: 'anthropic',
    hasApiKey: false,
    configOpen: false,
    crystalStoreRepo: '',
    hasCrystalToken: false,
    crystalConfigOpen: false,
  };

  let elapsedTimer = null;
  // Per-phase expansion overrides (user clicks). Keyed by phase id.
  // Empty object → use default expansion rules (running/failed expanded, others collapsed).
  const phaseExpansionOverrides = {};

  // Pre-populated phase tree shown the moment the user clicks Scan. The first engine poll
  // replaces it with the real phases array (same shape) within ~150ms, so the layout is
  // already correct and only glyphs/durations transition — no layout jump.
  function makeOptimisticPhases() {
    return [
      { id: 'harvest',            name: 'Harvest',            status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
      { id: 'scrub',              name: 'Scrub',              status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
      { id: 'crystal-query',      name: 'Crystal Query',      status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
      { id: 'discovery',          name: 'Discovery',          status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
      { id: 'deep-dives',         name: 'Deep Dives',         status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
      { id: 'artifacts',          name: 'Artifacts',          status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
      { id: 'crystal-extraction', name: 'Crystal Extraction', status: 'pending', startedAt: null, completedAt: null, durationMs: null, subtasks: [] },
    ];
  }

  // Flip to running state instantly on click — no IPC round-trip required for visible feedback.
  // Subsequent engine polls will overwrite this with real progress data.
  function applyOptimisticRunning() {
    state.running = true;
    state.progress = {
      status: 'queued',
      stage: 'Starting analysis…',
      phases: makeOptimisticPhases(),
      startedAt: new Date().toISOString(),
    };
    startElapsedTimer();
    render();
  }

  function formatElapsed(startedAt) {
    if (!startedAt) return '0:00';
    const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return String(m) + ':' + (s < 10 ? '0' : '') + String(s);
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    elapsedTimer = setInterval(function() {
      const el = document.getElementById('elapsed-timer');
      if (!el) return;
      el.textContent = formatElapsed(state.progress && state.progress.startedAt);
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  }

  const API_KEY_URLS = {
    copilot: '',
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    gemini: 'https://aistudio.google.com/app/apikey',
    azure: 'https://portal.azure.com/',
    ollama: '',
  };

  function post(msg) { vscode.postMessage(msg); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ── Rendering ─────────────────────────────────────────── */

  function render() {
    const app = document.getElementById('app');
    const { hasConfig, repos, running, configOpen, workspaceFolders } = state;
    let html = '';

    if (!running) {
      html += '<div class="status-bar">⚙ ' + esc(state.engineStatus) + '</div>';
    }

    if (!hasConfig) {
      html += renderStep1(false);
      html += renderStepTwoLocked();
    } else if (configOpen) {
      html += renderStep1(true);
      html += '<button class="btn btn-secondary cancel-btn" data-action="closeConfig">✕ Cancel</button>';
    } else if (running) {
      html += renderConfigSummary();
      html += renderProgress();
    } else {
      html += renderConfigSummary();
      html += renderMainAction(repos || [], workspaceFolders || []);
    }

    if (hasConfig && !configOpen) {
      html += renderCrystals();
    }

    app.innerHTML = html;
  }

  function renderStep1(editing) {
    const cfg = state;
    const keyUrl = API_KEY_URLS[cfg.provider] || '';
    const isOllama = cfg.provider === 'ollama' || cfg.provider === 'copilot';
    let html = '<div class="step-card">';
    html += '<div class="step-header">';
    html += '<span class="step-num">' + (cfg.hasConfig && !editing ? '✓' : '1') + '</span>';
    html += '<span class="step-title">Configure AI Provider</span>';
    html += '</div>';

    html += '<div class="form-row"><label>Provider</label>';
    html += '<select id="provider-select">';
    for (const p of ['copilot', 'anthropic', 'openai', 'gemini', 'azure', 'ollama']) {
      html += '<option value="' + p + '"' + (cfg.provider === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>';
    }
    html += '</select></div>';

    if (!isOllama) {
      html += '<div class="form-row">';
      html += '<div class="label-row">';
      html += '<label>API Key</label>';
      if (keyUrl) html += '<a class="btn-link key-link" data-ext="' + esc(keyUrl) + '">Get a free key ↗</a>';
      html += '</div>';
      html += '<div class="input-row">';
      html += '<input type="password" id="api-key-input" placeholder="Paste your API key here…" autocomplete="off">';
      html += '<button class="btn-icon" id="toggle-key" title="Show/hide key">👁</button>';
      html += '</div>';
      html += '</div>';
    } else {
      html += '<div class="provider-hint">' + (cfg.provider === 'copilot'
        ? 'Routes through your GitHub Copilot subscription — no API key needed.'
        : 'Ollama runs locally — no API key needed.') + '</div>';
    }

    html += '<div id="save-feedback" class="feedback hidden"></div>';
    html += '<div class="config-save-row">';
    html += '<button class="btn btn-primary save-btn" data-action="saveConfig">Save' + (editing ? '' : ' &amp; Continue →') + '</button>';
    if (!editing) {
      html += '<button class="btn btn-ghost test-btn" data-action="testConn">Test</button>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderStepTwoLocked() {
    return '<div class="step-card locked"><div class="step-header"><span class="step-num">2</span><span class="step-title">Select Repository</span></div><div class="empty-state">Complete step 1 first.</div></div>';
  }

  function renderMainAction(repos, workspaceFolders) {
    let html = '';
    if (repos.length === 1) {
      html += '<button class="btn btn-primary scan-btn full-width" data-action="runAnalysis">⚡ Scan &quot;' + esc(repos[0].label) + '&quot;</button>';
      html += renderDocsButton(repos[0].path);
      html += '<div style="margin-top:8px;text-align:center;"><button class="btn-link" data-action="addRepo">Change Repo</button></div>';
    } else if (repos.length > 1) {
      html += '<h3>Repositories</h3>';
      for (const r of repos) {
        html += '<div class="repo-item"><div><div class="repo-label" title="' + esc(r.path) + '">' + esc(r.label) + '</div>';
        html += '<div class="repo-path">' + esc(r.path) + '</div></div>';
        html += '<button class="btn-icon" data-remove="' + esc(r.path) + '" title="Remove">✕</button></div>';
      }
      html += '<div class="add-repo-row"><button class="btn btn-ghost add-repo-btn" data-action="addRepo">+ Add Repo</button></div>';
      html += '<hr class="divider"><button class="btn btn-primary scan-btn full-width" data-action="runAnalysis">⚡ Start Scan (' + String(repos.length) + ' repos)</button>';
      for (const r of repos) { html += renderDocsButton(r.path); }
    } else if (workspaceFolders.length > 0) {
      for (const ws of workspaceFolders) {
        html += '<button class="btn btn-primary scan-btn full-width" data-scan-path="' + esc(ws.path) + '" data-scan-name="' + esc(ws.name) + '">⚡ Scan &quot;' + esc(ws.name) + '&quot;</button>';
      }
      html += '<div style="margin-top:8px;text-align:center;"><button class="btn-link" data-action="addRepo">Browse for a different repo…</button></div>';
    } else {
      html += '<button class="btn btn-ghost full-width browse-repo-btn" data-action="addRepo">+ Browse for a repository…</button>';
    }
    return html;
  }

  function renderDocsButton(repoPath) {
    var info = (state.docsByRepo || {})[repoPath];
    if (!info) return '';
    var label, sub, action;
    if (info.status === 'missing' || info.status === 'empty') {
      label = '📄 Set Up Docs Ingest';
      sub = info.status === 'missing'
        ? 'Creates transition-docs/ with export instructions'
        : 'Folder ready — drop your exported docs in it';
      action = 'setupDocs';
    } else {
      label = '🔍 Run Comparison';
      sub = 'Compare docs in transition-docs/ vs. the code';
      action = 'runComparison';
    }
    var html = '<div style="margin-top:10px;">';
    html += '<button class="btn btn-ghost full-width" data-action="' + action + '" data-repo-path="' + esc(repoPath) + '" data-folder-path="' + esc(info.folderPath) + '">' + label + '</button>';
    html += '<div class="provider-hint" style="text-align:center;margin-top:4px;">' + esc(sub) + '</div>';
    if (info.status !== 'missing') {
      html += '<div style="text-align:center;margin-top:4px;"><button class="btn-link" data-action="openDocsFolder" data-folder-path="' + esc(info.folderPath) + '">Open folder ↗</button></div>';
    }
    html += '</div>';
    return html;
  }

  function renderConfigSummary() {
    const { provider, hasApiKey } = state;
    const isOllama = provider === 'ollama' || provider === 'copilot';
    const keyStatus = isOllama ? '' : (hasApiKey ? '· API key set' : '· <span class="warn-inline">⚠ no key</span>');
    return '<div class="config-summary">' +
      '<span class="check">✓</span>' +
      '<span>' + esc(provider.charAt(0).toUpperCase() + provider.slice(1)) + '</span>' +
      '<span class="dot">·</span>' +
      '<span class="muted">' + keyStatus + '</span>' +
      '<button class="btn-link edit-link" data-action="openConfig">Edit</button>' +
      '</div>';
  }

  function renderProgress() {
    const prog = state.progress || {};
    const phases = Array.isArray(prog.phases) ? prog.phases : [];
    const pct = computeProgressPercent(phases, prog.status);

    let html = '<div class="progress-section">';

    // Header: title + elapsed computed from startedAt
    html += '<div class="progress-header">';
    html += '<span class="progress-title">Analysis in Progress</span>';
    html += '<span class="progress-elapsed" id="elapsed-timer">' + formatElapsed(prog.startedAt) + '</span>';
    html += '</div>';

    // Real progress bar — fraction of phases complete + fractional credit for running phase.
    html += '<div class="progress-bar-track"><div class="progress-bar-fill" style="width:' + String(pct) + '%"></div></div>';

    // Current stage line (single-line summary for the impatient)
    if (prog.stage) {
      html += '<div class="progress-current"><span>' + esc(prog.stage) + '</span></div>';
    }

    // Phase tree — the hierarchical view
    html += renderPhaseTree(phases);

    html += '</div>';
    return html;
  }

  function renderPhaseTree(phases) {
    if (!phases || phases.length === 0) return '';

    let html = '<div class="phase-tree">';
    for (const phase of phases) {
      const isExpanded = isPhaseExpanded(phase);
      const hasSubtasks = Array.isArray(phase.subtasks) && phase.subtasks.length > 0;
      const caret = hasSubtasks ? (isExpanded ? '▾' : '▸') : '·';

      html += '<div class="phase">';
      html += '<div class="phase-row" data-phase-toggle="' + esc(phase.id) + '">';
      html += '<span class="phase-caret">' + caret + '</span>';
      html += '<span class="phase-glyph ' + statusClass(phase.status) + '">' + statusGlyph(phase.status) + '</span>';
      html += '<span class="phase-name ' + statusClass(phase.status) + '">' + esc(phase.name) + '</span>';
      if (phase.badge) {
        html += '<span class="phase-badge">' + esc(phase.badge) + '</span>';
      }
      if (phase.durationMs != null) {
        html += '<span class="phase-duration">' + formatDuration(phase.durationMs) + '</span>';
      } else if (phase.status === 'running' && phase.startedAt) {
        html += '<span class="phase-duration">' + formatElapsed(phase.startedAt) + '</span>';
      }
      html += '</div>';

      if (isExpanded && hasSubtasks) {
        html += '<div class="subtask-list">';
        for (const sub of phase.subtasks) {
          html += '<div class="subtask">';
          html += '<span class="subtask-glyph ' + statusClass(sub.status) + '">' + statusGlyph(sub.status) + '</span>';
          html += '<span class="subtask-label ' + (sub.status === 'pending' ? 'pending' : '') + '">' + esc(sub.label) + '</span>';
          if (sub.detail) {
            html += '<span class="subtask-detail">' + esc(sub.detail) + '</span>';
          }
          if (sub.durationMs != null && sub.durationMs > 100) {
            html += '<span class="subtask-duration">' + formatDuration(sub.durationMs) + '</span>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // Phase expansion state lives in the webview only — never pushed back to engine.
  // Default: running phase auto-expanded; complete and pending phases collapsed.
  // User clicks override the default and are remembered in phaseExpansionOverrides.
  function isPhaseExpanded(phase) {
    if (phase.id in phaseExpansionOverrides) return phaseExpansionOverrides[phase.id];
    if (phase.status === 'running') return true;
    if (phase.status === 'failed') return true;
    return false;
  }

  function statusGlyph(status) {
    switch (status) {
      case 'complete': return '✓';
      case 'running':  return '⟳';
      case 'failed':   return '✗';
      case 'skipped':  return '–';
      case 'pending':  return '⌛';
      default:         return '·';
    }
  }

  function statusClass(status) {
    return status || 'pending';
  }

  function formatDuration(ms) {
    if (ms < 1000) return String(ms) + 'ms';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function computeProgressPercent(phases, status) {
    if (status === 'complete') return 100;
    if (!phases || phases.length === 0) return progressWidth(status);
    let progress = 0;
    for (const phase of phases) {
      if (phase.status === 'complete') {
        progress += 1;
      } else if (phase.status === 'running') {
        // Fractional credit based on subtask completion within the running phase
        const subs = phase.subtasks || [];
        if (subs.length > 0) {
          const done = subs.filter(s => s.status === 'complete').length;
          progress += done / subs.length;
        } else {
          progress += 0.3;
        }
        break;
      }
    }
    return Math.min(99, Math.round((progress / phases.length) * 100));
  }

  function renderCrystals() {
    const count = state.crystalCount;
    const repo = state.crystalStoreRepo || '';
    const hasToken = state.hasCrystalToken || false;
    const open = state.crystalConfigOpen || false;
    const shortRepo = repo ? repo.replace('https://github.com/', '') : '';

    let html = '<h3>Crystal Store</h3>';
    html += '<div class="crystal-row">';
    html += '<span class="crystal-chip">💎 ' + String(count) + ' crystal' + (count !== 1 ? 's' : '') + '</span>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<button class="btn btn-secondary sync-btn" data-action="syncCrystals">↺ Sync</button>';
    html += '<button class="btn btn-ghost sync-btn" data-action="toggleCrystalConfig" title="Configure Crystal Store">' + (open ? '✕' : '⚙') + '</button>';
    html += '</div></div>';

    if (!open && repo) {
      html += '<div class="provider-hint" style="margin-top:4px;">→ ' + esc(shortRepo) + (hasToken ? ' · key set' : ' · <span style="color:var(--vscode-charts-yellow,#ffc107)">no token</span>') + '</div>';
    } else if (!open) {
      html += '<div class="provider-hint" style="margin-top:4px;"><button class="btn-link" data-action="toggleCrystalConfig">Configure shared store →</button></div>';
    }

    if (open) {
      html += '<div style="margin-top:8px;">';
      html += '<div class="form-row"><label>Repository URL</label>';
      html += '<input type="text" id="crystal-repo-input" placeholder="https://github.com/you/geodesic-crystals" value="' + esc(repo) + '"></div>';
      html += '<div class="form-row"><label>Access token' + (hasToken ? ' <span style="color:var(--vscode-charts-green,#4caf50)">· saved</span>' : '') + '</label>';
      html += '<input type="password" id="crystal-token-input" placeholder="' + (hasToken ? 'leave blank to keep existing' : 'ghp_…') + '" autocomplete="off"></div>';
      html += '<div style="display:flex;gap:6px;">';
      html += '<button class="btn btn-primary" style="flex:1;padding:5px;" data-action="saveCrystalStore">Save</button>';
      if (repo) html += '<button class="btn btn-ghost" style="padding:5px 8px;" data-action="clearCrystalStore">Clear</button>';
      html += '</div>';
      html += '<div id="crystal-feedback" class="feedback hidden"></div>';
      html += '</div>';
    }

    return html;
  }

  function progressWidth(status) {
    const map = { queued: 5, harvesting: 20, scrubbing: 40, 'querying-crystal': 55, synthesizing: 75, writing: 90, complete: 100, failed: 100 };
    return map[status] || 10;
  }

  /* ── Actions ───────────────────────────────────────────── */

  function showFeedback(msg, type) {
    const el = document.getElementById('save-feedback');
    if (!el) return;
    el.className = 'feedback ' + type;
    el.textContent = msg;
  }

  function saveConfig() {
    const select = document.getElementById('provider-select');
    const keyInput = document.getElementById('api-key-input');
    const provider = select ? select.value : state.provider;
    const apiKey = keyInput ? keyInput.value.trim() : '';
    if (provider !== 'ollama' && provider !== 'copilot' && !apiKey) {
      showFeedback('API key is required for ' + provider, 'error');
      return;
    }
    showFeedback('Saving…', 'info');
    state.provider = provider;
    post({ type: 'configureProvider', provider, apiKey });
  }

  function testConn() {
    showFeedback('Testing connection…', 'info');
    post({ type: 'testConnection' });
  }

  function addRepo() { post({ type: 'addRepo' }); }
  function runAnalysis() {
    const paths = (state.repos || []).map(function(r) { return r.path; });
    if (paths.length === 0) return;
    applyOptimisticRunning();
    post({ type: 'runAnalysis', paths });
  }
  function syncCrystals() { post({ type: 'syncCrystals' }); }
  function toggleCrystalConfig() { state.crystalConfigOpen = !state.crystalConfigOpen; render(); }
  function saveCrystalStore() {
    var repoInput = document.getElementById('crystal-repo-input');
    var tokenInput = document.getElementById('crystal-token-input');
    var repoUrl = repoInput ? repoInput.value.trim() : '';
    var token = tokenInput ? tokenInput.value.trim() : '';
    if (repoUrl && !repoUrl.startsWith('https://') && !repoUrl.startsWith('git@')) {
      var fb = document.getElementById('crystal-feedback');
      if (fb) { fb.className = 'feedback error'; fb.textContent = 'URL must start with https:// or git@'; }
      return;
    }
    post({ type: 'saveCrystalStore', repoUrl: repoUrl, token: token });
  }
  function clearCrystalStore() { post({ type: 'clearCrystalStore' }); }
  function openConfig() { state.configOpen = true; render(); }
  function closeConfig() { state.configOpen = false; render(); }

  /* ── Event delegation — NO inline onclick anywhere ──────── */

  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el) return;

    // Phase expand/collapse — check element and parent (clicking glyph or label still toggles)
    var phaseToggle = el.dataset && el.dataset.phaseToggle ? el : (el.closest ? el.closest('[data-phase-toggle]') : null);
    if (phaseToggle && phaseToggle.dataset.phaseToggle) {
      var pid = phaseToggle.dataset.phaseToggle;
      var phases = (state.progress && state.progress.phases) || [];
      var phase = null;
      for (var i = 0; i < phases.length; i++) { if (phases[i].id === pid) { phase = phases[i]; break; } }
      var currentlyExpanded = (pid in phaseExpansionOverrides)
        ? phaseExpansionOverrides[pid]
        : (phase && (phase.status === 'running' || phase.status === 'failed'));
      phaseExpansionOverrides[pid] = !currentlyExpanded;
      render();
      return;
    }

    // Remove repo (data-remove)
    if (el.dataset && el.dataset.remove !== undefined) {
      post({ type: 'removeRepo', path: el.dataset.remove });
      return;
    }

    // Use workspace (data-ws-path) — check element and parent
    if (el.dataset && el.dataset.wsPath !== undefined) {
      post({ type: 'useWorkspace', path: el.dataset.wsPath, name: el.dataset.wsName || el.dataset.wsPath });
      return;
    }
    var wsParent = el.closest('[data-ws-path]');
    if (wsParent && wsParent.dataset.wsPath) {
      post({ type: 'useWorkspace', path: wsParent.dataset.wsPath, name: wsParent.dataset.wsName || wsParent.dataset.wsPath });
      return;
    }

    // Scan workspace in one click (data-scan-path) — adds repo + starts scan
    if (el.dataset && el.dataset.scanPath !== undefined) {
      applyOptimisticRunning();
      post({ type: 'scanWorkspace', path: el.dataset.scanPath, name: el.dataset.scanName || el.dataset.scanPath });
      return;
    }
    var scanParent = el.closest('[data-scan-path]');
    if (scanParent && scanParent.dataset.scanPath) {
      applyOptimisticRunning();
      post({ type: 'scanWorkspace', path: scanParent.dataset.scanPath, name: scanParent.dataset.scanName || scanParent.dataset.scanPath });
      return;
    }

    // Open external link (data-ext)
    if (el.dataset && el.dataset.ext) {
      post({ type: 'openExternal', url: el.dataset.ext });
      return;
    }

    // Toggle API key visibility
    if (el.id === 'toggle-key') {
      var inp = document.getElementById('api-key-input');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
      return;
    }

    // Generic action (data-action) — check element and nearest parent
    var actionEl = el.dataset && el.dataset.action ? el : el.closest('[data-action]');
    if (actionEl && actionEl.dataset.action) {
      switch (actionEl.dataset.action) {
        case 'addRepo':             addRepo();             break;
        case 'runAnalysis':         runAnalysis();         break;
        case 'saveConfig':          saveConfig();          break;
        case 'testConn':            testConn();            break;
        case 'openConfig':          openConfig();          break;
        case 'closeConfig':         closeConfig();         break;
        case 'syncCrystals':        syncCrystals();        break;
        case 'toggleCrystalConfig': toggleCrystalConfig(); break;
        case 'saveCrystalStore':    saveCrystalStore();    break;
        case 'clearCrystalStore':   clearCrystalStore();   break;
        case 'setupDocs': {
          var rp = actionEl.dataset.repoPath || '';
          if (rp) post({ type: 'setupDocs', repoPath: rp });
          break;
        }
        case 'openDocsFolder': {
          var fp = actionEl.dataset.folderPath || '';
          if (fp) post({ type: 'openDocsFolder', folderPath: fp });
          break;
        }
        case 'runComparison': {
          var rp2 = actionEl.dataset.repoPath || '';
          if (rp2) {
            applyOptimisticRunning();
            post({ type: 'runAnalysis', paths: [rp2] });
          }
          break;
        }
      }
    }
  });

  // Provider select change — no inline onchange
  document.addEventListener('change', function(e) {
    var el = e.target;
    if (el && el.id === 'provider-select') {
      state.provider = el.value;
      render();
    }
  });

  /* ── Message handler ───────────────────────────────────── */

  window.addEventListener('message', function(ev) {
    var msg = ev.data;
    if (msg.type === 'stateUpdate') {
      const wasRunning = state.running;
      state = Object.assign({}, state, msg.state);
      if (state.running && !wasRunning) startElapsedTimer();
      if (!state.running && wasRunning) stopElapsedTimer();
      render();
    }
    if (msg.type === 'configFeedback') {
      showFeedback(msg.text, msg.kind || 'success');
    }
    if (msg.type === 'crystalConfigFeedback') {
      var fb = document.getElementById('crystal-feedback');
      if (fb) { fb.className = 'feedback ' + (msg.kind || 'success'); fb.textContent = msg.text; }
    }
  });

  post({ type: 'ready' });
  render();
})();
</script>
</body>
</html>`;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: ExtensionState,
    private readonly engineManager: EngineManager,
    private readonly callbacks: SidebarCallbacks,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: true };

    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    view.webview.html = getSidebarHtml(view.webview, nonce);

    view.webview.onDidReceiveMessage(async (msg: SidebarMessage) => {
      switch (msg.type) {
        case 'ready':
          await this.pushState();
          break;

        case 'addRepo': {
          const uris = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Repository',
            title: 'Select Repository to Analyze',
          });
          if (uris?.[0]) {
            await this.state.addRepo(uris[0].fsPath);
            await this.pushState();
          }
          break;
        }

        case 'useWorkspace':
          await this.state.addRepo(msg.path);
          await this.pushState();
          break;

        case 'scanWorkspace':
          await this.state.addRepo(msg.path);
          // Push repos + running=true in one message so the intermediate "Start Scan" screen never appears
          await this.pushState(undefined, true);
          this.callbacks.onRunAnalysis([msg.path]);
          break;

        case 'removeRepo':
          await this.state.removeRepo(msg.path);
          await this.pushState();
          break;

        case 'runAnalysis':
          this.callbacks.onRunAnalysis(msg.paths);
          break;

        case 'configureProvider':
          await this.callbacks.onConfigureProvider(msg.provider, msg.apiKey);
          await this.pushState();
          await this._view?.webview.postMessage({
            type: 'configFeedback',
            text: `Provider saved: ${msg.provider}`,
            kind: 'success',
          });
          break;

        case 'testConnection': {
          const client = this.callbacks.getClient();
          if (!client) {
            await this._view?.webview.postMessage({
              type: 'configFeedback',
              text: 'Engine not running yet — please wait',
              kind: 'error',
            });
            break;
          }
          try {
            const health = await client.testConnection();
            await this._view?.webview.postMessage({
              type: 'configFeedback',
              text: health.healthy
                ? `✓ Connected (${String(health.latencyMs)}ms)`
                : `✗ ${health.error ?? 'Connection failed'}`,
              kind: health.healthy ? 'success' : 'error',
            });
          } catch (err) {
            const msg2 = err instanceof Error ? err.message : String(err);
            await this._view?.webview.postMessage({
              type: 'configFeedback',
              text: `✗ ${msg2}`,
              kind: 'error',
            });
          }
          break;
        }

        case 'syncCrystals': {
          const client2 = this.callbacks.getClient();
          if (!client2) break;
          try {
            const result = await client2.syncCrystals();
            void vscode.window.showInformationMessage(result.message);
            await this.pushState();
          } catch (err) {
            const msg3 = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`Sync failed: ${msg3}`);
          }
          break;
        }

        case 'saveCrystalStore':
          this.callbacks.onSaveCrystalStore(msg.repoUrl, msg.token);
          await this.pushState();
          await this._view?.webview.postMessage({
            type: 'crystalConfigFeedback',
            text: msg.repoUrl ? `Crystal Store saved — run ↺ Sync to connect` : 'Crystal Store cleared',
            kind: 'success',
          });
          break;

        case 'clearCrystalStore':
          this.callbacks.onClearCrystalStore();
          await this.pushState();
          await this._view?.webview.postMessage({
            type: 'crystalConfigFeedback',
            text: 'Crystal Store cleared — running local-only',
            kind: 'info',
          });
          break;

        case 'openExternal':
          if (msg.url) {
            void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;

        case 'setupDocs': {
          const docsClient = this.callbacks.getClient();
          if (!docsClient) {
            void vscode.window.showWarningMessage('Engine not running yet — please wait a moment and try again.');
            break;
          }
          try {
            const result = await docsClient.setupDocs(msg.repoPath);
            const action = result.created ? 'Created' : 'Found';
            const choice = await vscode.window.showInformationMessage(
              `${action} transition-docs folder. Drop your exported docs in it, then click "Run Comparison".`,
              'Open Folder',
            );
            if (choice === 'Open Folder') {
              void vscode.env.openExternal(vscode.Uri.file(result.folderPath));
            }
            // Refresh so the button flips from "Set Up Docs Ingest" → "Run Comparison"
            // once the user drops docs into the folder.
            await this.pushState();
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`Set up docs failed: ${errMsg}`);
          }
          break;
        }

        case 'openDocsFolder':
          if (msg.folderPath) {
            void vscode.env.openExternal(vscode.Uri.file(msg.folderPath));
          }
          break;
      }
    });

    this.engineManager.onStatusChange(async (status) => {
      await this.pushState(status);
    });

    this.state.onDidChange(async () => {
      await this.pushState();
    });
  }

  async pushState(engineStatusOverride?: string, running?: boolean): Promise<void> {
    if (!this._view) return;

    const client = this.callbacks.getClient();
    let crystalCount = 0;

    if (client) {
      try {
        const crystals = await client.listCrystals();
        crystalCount = crystals.length;
      } catch { /* engine not ready */ }
    }

    const configInfo = this.callbacks.getConfigInfo();
    const crystalConfig = this.callbacks.getCrystalConfig();
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? [])
      .map(f => ({ name: f.name, path: f.uri.fsPath }));

    // Fetch docs folder status for each repo so the sidebar can show
    // "Set Up Docs Ingest" vs "Run Comparison" per repo.
    const docsByRepo: Record<string, { status: string; folderPath: string }> = {};
    if (client) {
      for (const r of this.state.getRepos()) {
        try {
          const ds = await client.docsStatus(r.path);
          docsByRepo[r.path] = { status: ds.status, folderPath: ds.folderPath };
        } catch { /* engine not ready yet */ }
      }
    }

    const state: Record<string, unknown> = {
      repos: this.state.getRepos(),
      workspaceFolders,
      engineStatus: engineStatusOverride ?? (
        this.engineManager.port
          ? `Engine running on port ${String(this.engineManager.port)}`
          : 'Engine starting…'
      ),
      crystalCount,
      hasConfig: configInfo !== null && (configInfo.hasApiKey || configInfo.provider === 'ollama' || configInfo.provider === 'copilot'),
      provider: configInfo?.provider ?? 'anthropic',
      hasApiKey: configInfo?.hasApiKey ?? false,
      crystalStoreRepo: crystalConfig.repoUrl,
      hasCrystalToken: crystalConfig.hasToken,
      docsByRepo,
    };

    if (running !== undefined) {
      state['running'] = running;
      if (running) {
        // Placeholder progress for the brief window between user click and first engine poll.
        // The engine's createJob() builds the full phase tree; the next poll replaces this.
        state['progress'] = {
          status: 'queued',
          stage: 'Starting…',
          phases: [],
          startedAt: new Date().toISOString(),
        };
      }
    }

    await this._view.webview.postMessage({ type: 'stateUpdate', state });
  }

  async updateProgress(progress: unknown): Promise<void> {
    if (!this._view) return;
    await this._view.webview.postMessage({
      type: 'stateUpdate',
      state: { running: true, progress },
    });
  }

  async clearProgress(): Promise<void> {
    if (!this._view) return;
    await this._view.webview.postMessage({
      type: 'stateUpdate',
      state: { running: false, progress: null },
    });
  }
}

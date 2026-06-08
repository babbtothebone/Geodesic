import * as vscode from 'vscode';

interface FullJob {
  progress: { status: string; stage: string; phiZoneCount: number; crystalMatch: string | null; crystalMatchScore: number | null };
  result: {
    synthesis: {
      skillFile: { meta: { repo: string; analyzedAt: string; analysisDurationMs: number }; phiZones: Array<{ file: string; lineStart: number; lineEnd: number; phiFieldCount: number; protectionMissing: string[] }> };
      gapReport: { repoName: string; overallScore: number; overallGrade: string; dimensions: Array<{ dimension: string; score: number; grade: string; active: boolean; findings: Array<{ severity: string; description: string; file: string; lineStart: number; lineEnd: number; detail: string; fix: string; deduction: number }> }>; uncertainDetections: Array<{ file: string; lineStart: number; lineEnd: number; trigger: string; confidencePct: number; recommendedAction: string }> };
      architectureMapMarkdown: string;
    };
    artifactPaths: { architectureMap: string; skillFileJson: string; skillFileMd: string; gapReport: string };
    fingerprint: string;
  };
  error: string | null;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function severityClass(sev: string): string {
  if (sev === 'P0') return '#f14c4c';
  if (sev === 'P1') return '#cca700';
  if (sev === 'P2') return '#3794ff';
  return '#999';
}

function gradeColor(grade: string): string {
  if (grade === 'A') return '#4ec9b0';
  if (grade === 'B') return '#9cdcfe';
  if (grade === 'C') return '#cca700';
  if (grade === 'D') return '#f14c4c';
  return '#f14c4c';
}

function buildArchTab(markdown: string): string {
  // Convert simple markdown to HTML
  const html = markdown
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => '<ul>' + s + '</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<div class="pane-body arch-tab"><div class="markdown-body"><p>${html}</p></div></div>`;
}

function buildSkillTab(synthesis: FullJob['result']['synthesis']): string {
  const sf = synthesis.skillFile;
  const jsonStr = escHtml(JSON.stringify(sf, null, 2));
  return `<div class="pane-body skill-tab">
    <div class="skill-header">
      <span>${escHtml(sf.meta.repo)}</span>
      <span class="muted">${escHtml(sf.meta.analyzedAt.slice(0, 10))}</span>
      <span class="muted">${String(Math.round(sf.meta.analysisDurationMs / 1000))}s</span>
    </div>
    <pre class="code-block" id="skill-json">${jsonStr}</pre>
    ${sf.phiZones.length > 0 ? `<div class="phi-zones"><h3>PHI Zones (${String(sf.phiZones.length)})</h3>${sf.phiZones.map(z =>
      `<div class="phi-zone" data-open-file="${escHtml(z.file)}" data-open-line="${String(z.lineStart)}">
        <span class="phi-file">${escHtml(z.file)}</span>
        <span class="phi-lines">lines ${String(z.lineStart)}–${String(z.lineEnd)}</span>
        <span class="phi-count">${String(z.phiFieldCount)} PHI fields</span>
        ${z.protectionMissing.length > 0 ? `<div class="phi-missing">Missing: ${escHtml(z.protectionMissing.join(', '))}</div>` : ''}
      </div>`
    ).join('')}</div>` : ''}
  </div>`;
}

function buildGapTab(synthesis: FullJob['result']['synthesis']): string {
  const gr = synthesis.gapReport;
  const dims = gr.dimensions;

  const scoreBar = (score: number) => `<div class="score-bar"><div class="score-fill" style="width:${String(score)}%;background:${gradeColor(score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F')}"></div></div>`;

  let html = `<div class="pane-body gap-tab">
    <div class="overall-score">
      <span class="score-num" style="color:${gradeColor(gr.overallGrade)}">${String(gr.overallScore)}</span>
      <span class="score-grade" style="color:${gradeColor(gr.overallGrade)}">${escHtml(gr.overallGrade)}</span>
      <span class="muted">${escHtml(gr.repoName)}</span>
    </div>
    <div class="filter-row">
      Filter: <button class="btn-tab active" data-filter="all">All</button>
      <button class="btn-tab" data-filter="P0">P0</button>
      <button class="btn-tab" data-filter="P1">P1</button>
      <button class="btn-tab" data-filter="P2">P2</button>
      <button class="btn-tab" data-filter="P3">P3</button>
    </div>`;

  for (const dim of dims) {
    if (!dim.active) continue;
    html += `<div class="dim-section">
      <div class="dim-header">
        <strong>${escHtml(dim.dimension)}</strong>
        <span style="color:${gradeColor(dim.grade)}">${String(dim.score)} ${escHtml(dim.grade)}</span>
      </div>
      ${scoreBar(dim.score)}`;

    for (const f of dim.findings) {
      html += `<div class="finding" data-severity="${escHtml(f.severity)}" data-open-file="${escHtml(f.file)}" data-open-line="${String(f.lineStart)}">
        <div class="finding-header">
          <span class="sev-badge" style="background:${severityClass(f.severity)}">${escHtml(f.severity)}</span>
          <span class="finding-desc">${escHtml(f.description)}</span>
        </div>
        <div class="finding-loc muted">${escHtml(f.file)} lines ${String(f.lineStart)}–${String(f.lineEnd)}</div>
        <div class="finding-detail muted">${escHtml(f.detail)}</div>
        <div class="finding-fix">Fix: ${escHtml(f.fix)}</div>
      </div>`;
    }
    html += '</div>';
  }

  if (gr.uncertainDetections.length > 0) {
    html += '<div class="dim-section"><div class="dim-header"><strong>⚠ Uncertain PII Detections</strong></div>';
    for (const ud of gr.uncertainDetections) {
      html += `<div class="finding uncertain" data-open-file="${escHtml(ud.file)}" data-open-line="${String(ud.lineStart)}">
        <div class="finding-loc">${escHtml(ud.file)} lines ${String(ud.lineStart)}–${String(ud.lineEnd)}</div>
        <div class="finding-detail muted">${escHtml(ud.trigger)} (${String(ud.confidencePct)}% confidence)</div>
        <div class="finding-fix">Action: ${escHtml(ud.recommendedAction)}</div>
      </div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function formatDurationFromMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${String(s)}s`;
  return `${String(m)}m ${String(s).padStart(2, '0')}s`;
}

function getResultsHtml(nonce: string, job: FullJob): string {
  const r = job.result;
  const archHtml = buildArchTab(r.synthesis.architectureMapMarkdown);
  const skillHtml = buildSkillTab(r.synthesis);
  const gapHtml = buildGapTab(r.synthesis);
  const gr = r.synthesis.gapReport;
  const elapsed = formatDurationFromMs(r.synthesis.skillFile.meta.analysisDurationMs);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Geodesic — ${escHtml(gr.repoName)}</title>
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .completion-banner { display: flex; align-items: center; gap: 14px; padding: 10px 16px; background: var(--vscode-textBlockQuote-background); border-bottom: 1px solid var(--vscode-editorGroup-border); flex-shrink: 0; }
  .completion-check { color: var(--vscode-charts-green, #4caf50); font-size: 16px; font-weight: 700; flex-shrink: 0; }
  .completion-title { font-size: 13px; font-weight: 600; }
  .completion-sep { color: var(--vscode-descriptionForeground); }
  .completion-time { font-variant-numeric: tabular-nums; font-weight: 600; }
  .completion-grade { font-weight: 700; padding: 1px 7px; border-radius: 3px; font-size: 12px; }
  .tabs { display: flex; background: var(--vscode-editorGroupHeader-tabsBackground); border-bottom: 1px solid var(--vscode-editorGroup-border); flex-shrink: 0; }
  .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; border-right: 1px solid var(--vscode-editorGroup-border); user-select: none; }
  .tab.active { background: var(--vscode-editor-background); border-bottom: 2px solid var(--vscode-focusBorder); }
  .tab:hover:not(.active) { background: var(--vscode-tab-hoverBackground); }
  .tab-content { display: none; flex: 1; overflow-y: auto; padding: 16px; }
  .tab-content.visible { display: block; }
  .markdown-body h1 { font-size: 1.4em; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); padding-bottom: 4px; }
  .markdown-body h2 { font-size: 1.15em; margin: 12px 0 6px; }
  .markdown-body h3 { font-size: 1em; margin: 8px 0 4px; }
  .markdown-body ul { padding-left: 20px; margin: 4px 0; }
  .markdown-body li { margin: 2px 0; }
  .markdown-body code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 2px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .overall-score { display: flex; align-items: baseline; gap: 12px; padding: 12px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; margin-bottom: 12px; }
  .score-num { font-size: 2.5em; font-weight: 700; line-height: 1; }
  .score-grade { font-size: 1.5em; font-weight: 700; }
  .filter-row { display: flex; align-items: center; gap: 4px; margin-bottom: 12px; font-size: 11px; flex-wrap: wrap; }
  .btn-tab { padding: 2px 8px; font-size: 11px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 2px; font-family: inherit; }
  .btn-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .dim-section { margin-bottom: 16px; }
  .dim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .score-bar { height: 4px; background: var(--vscode-textBlockQuote-background); border-radius: 2px; margin-bottom: 8px; }
  .score-fill { height: 100%; border-radius: 2px; }
  .finding { padding: 8px; margin: 4px 0; border: 1px solid var(--vscode-editorGroup-border); border-radius: 3px; cursor: pointer; }
  .finding:hover { background: var(--vscode-list-hoverBackground); }
  .finding.uncertain { border-left: 3px solid var(--vscode-charts-yellow); }
  .finding-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .sev-badge { padding: 1px 5px; border-radius: 2px; font-size: 10px; font-weight: 700; color: white; }
  .finding-desc { font-size: 12px; font-weight: 500; }
  .finding-loc { font-size: 11px; margin: 2px 0; }
  .finding-detail { font-size: 11px; margin: 2px 0; }
  .finding-fix { font-size: 11px; margin-top: 4px; color: var(--vscode-foreground); }
  .finding[data-severity="P0"] { border-left: 3px solid #f14c4c; }
  .finding[data-severity="P1"] { border-left: 3px solid #cca700; }
  .finding[data-severity="P2"] { border-left: 3px solid #3794ff; }
  .skill-header { display: flex; gap: 16px; align-items: center; padding: 8px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; margin-bottom: 8px; }
  .toggle-row { margin-bottom: 8px; }
  .code-block { font-family: var(--vscode-editor-font-family); font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre; }
  .phi-zones { margin-top: 12px; }
  .phi-zones h3 { margin-bottom: 8px; }
  .phi-zone { padding: 8px; border: 1px solid var(--vscode-charts-yellow); border-radius: 3px; margin: 4px 0; cursor: pointer; font-size: 12px; }
  .phi-zone:hover { background: var(--vscode-list-hoverBackground); }
  .phi-file { font-weight: 500; }
  .phi-lines, .phi-count { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .phi-missing { color: #f14c4c; font-size: 11px; margin-top: 4px; }
  .artifacts { padding: 12px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; margin-top: 12px; }
  .artifacts a { color: var(--vscode-textLink-foreground); text-decoration: none; font-size: 12px; }
  .artifacts a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="completion-banner">
  <span class="completion-check">✓</span>
  <span class="completion-title">Analysis complete</span>
  <span class="completion-sep">·</span>
  <span>${escHtml(gr.repoName)}</span>
  <span class="completion-sep">·</span>
  <span class="completion-time">${escHtml(elapsed)}</span>
  <span class="completion-sep">·</span>
  <span class="completion-grade" style="color:${gradeColor(gr.overallGrade)};background:rgba(128,128,128,0.12)">${escHtml(gr.overallGrade)} ${String(gr.overallScore)}/100</span>
</div>
<div class="tabs">
  <div class="tab active" id="tab-arch"  data-tab="arch">Architecture</div>
  <div class="tab"        id="tab-skill" data-tab="skill">Skill File</div>
  <div class="tab"        id="tab-gap"   data-tab="gap">Gap Report (${escHtml(gr.overallGrade)} ${String(gr.overallScore)})</div>
</div>
<div id="pane-arch"  class="tab-content visible">${archHtml}</div>
<div id="pane-skill" class="tab-content">${skillHtml}</div>
<div id="pane-gap"   class="tab-content">${gapHtml}</div>
<div class="artifacts">
  Artifacts:
  <a href="#" data-artifact="arch">architecture-map.md</a> ·
  <a href="#" data-artifact="json">skill-file.geodesic.json</a> ·
  <a href="#" data-artifact="md">skill-file.geodesic.md</a> ·
  <a href="#" data-artifact="gap">gap-report.md</a>
</div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const artifactPaths = ${JSON.stringify(r.artifactPaths)};

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(t){ t.classList.remove('visible'); });
    var tab = document.getElementById('tab-' + name);
    var pane = document.getElementById('pane-' + name);
    if (tab) tab.classList.add('active');
    if (pane) pane.classList.add('visible');
  }

  function filterFindings(sev, btnEl) {
    document.querySelectorAll('.filter-row .btn-tab').forEach(function(b){ b.classList.remove('active'); });
    if (btnEl) btnEl.classList.add('active');
    document.querySelectorAll('.finding').forEach(function(f){
      var fSev = f.dataset.severity;
      f.style.display = (sev === 'all' || fSev === sev) ? '' : 'none';
    });
  }

  function openFile(file, line) {
    if (!file) return;
    vscode.postMessage({ type: 'openFile', file: file, line: line ? Number(line) : 1 });
  }

  function openArtifact(type) {
    var paths = {
      arch: artifactPaths.architectureMap,
      json: artifactPaths.skillFileJson,
      md:   artifactPaths.skillFileMd,
      gap:  artifactPaths.gapReport,
    };
    var p = paths[type];
    if (p) vscode.postMessage({ type: 'openFile', file: p, line: 1 });
  }

  // Single delegated click handler — CSP forbids inline onclick attributes.
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el || !el.closest) return;

    var tabEl = el.closest('[data-tab]');
    if (tabEl) { switchTab(tabEl.dataset.tab); return; }

    var filterEl = el.closest('[data-filter]');
    if (filterEl) { filterFindings(filterEl.dataset.filter, filterEl); return; }

    var artifactEl = el.closest('[data-artifact]');
    if (artifactEl) { e.preventDefault(); openArtifact(artifactEl.dataset.artifact); return; }

    var openFileEl = el.closest('[data-open-file]');
    if (openFileEl) { openFile(openFileEl.dataset.openFile, openFileEl.dataset.openLine); return; }
  });
})();
</script>
</body>
</html>`;
}

export class ResultsPanel implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | null = null;

  open(job: FullJob, context: vscode.ExtensionContext): void {
    const repoName = job.result.synthesis.gapReport.repoName;

    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
    } else {
      this._panel = vscode.window.createWebviewPanel(
        'geodesic.results',
        `Geodesic — ${repoName}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
      );

      this._panel.onDidDispose(() => { this._panel = null; });

      this._panel.webview.onDidReceiveMessage((msg: { type: string; file?: string; line?: number }) => {
        if (msg.type === 'openFile' && msg.file) {
          const uri = vscode.Uri.file(msg.file);
          void vscode.window.showTextDocument(uri, {
            selection: msg.line
              ? new vscode.Range(msg.line - 1, 0, msg.line - 1, 0)
              : undefined,
          });
        }
      });
    }

    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    this._panel.title = `Geodesic — ${repoName}`;
    this._panel.webview.html = getResultsHtml(nonce, job);
    void context;
  }

  dispose(): void {
    this._panel?.dispose();
  }
}

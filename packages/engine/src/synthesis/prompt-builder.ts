import type { HarvestResult, Crystal, FileRecord, IngestedDocsBundle } from '@geodesic/types';

// Token estimate: 1 token ≈ 3 chars (code is dense)
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

// Maximum source files to render with full extraction (exports/imports/classes/etc.) inside
// a deep-dive subsystem prompt. Files past this budget appear as a path-only inventory so
// the AI still sees the full surface area without blowing the prompt token budget.
//
// At medplum scale (~5K files) a single subsystem like packages/server can have 1500+ source
// files. Without this cap, deep-dive prompts hit hundreds of KB → context-window failures
// and runaway token cost. Schemas, env files, configs, scripts, hub files, and entry points
// are ALWAYS included regardless of the cap because they are architecturally critical.
const SUBSYSTEM_SOURCE_DETAIL_CAP = 200;

// Rank source FileRecords by architectural importance for prompt inclusion. Inbound import
// count first (most-imported = most architecturally significant), outbound count as tiebreaker
// (highly-connected leaves still matter), then path lexicographic for full determinism.
function rankSourceRecords(
  records: FileRecord[],
  edges: HarvestResult['importGraph']['edges'],
): FileRecord[] {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const e of edges) {
    if (e.isExternal) continue;
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    outbound.set(e.from, (outbound.get(e.from) ?? 0) + 1);
  }
  return [...records].sort((a, b) => {
    const ai = inbound.get(a.path) ?? 0;
    const bi = inbound.get(b.path) ?? 0;
    if (ai !== bi) return bi - ai;
    const ao = outbound.get(a.path) ?? 0;
    const bo = outbound.get(b.path) ?? 0;
    if (ao !== bo) return bo - ao;
    return a.path.localeCompare(b.path);
  });
}


// ─── Transition Documents ─────────────────────────────────────────────────────
const PER_DOC_CHAR_CAP = 12_000;
const TOTAL_DOC_CHAR_CAP = 80_000;

function formatTransitionDocs(bundle: IngestedDocsBundle | null): string {
  if (!bundle || (bundle.docs.length === 0 && bundle.knownGaps.length === 0)) return '';

  const lines: string[] = [];
  if (bundle.docs.length > 0) {
    lines.push('## Transition Documents (User-Provided "Source of Truth")');
    lines.push('');
    lines.push(`The user dropped ${String(bundle.docs.length)} document(s) into \`transition-docs/\` describing how the system is **supposed to be** architected.`);
    lines.push('');
    lines.push('**Your job:** Compare these documents against the harvested code (below) and surface every divergence in the Gap Report under a new "Documentation Drift" theme:');
    lines.push('- Components/databases/APIs in docs but **missing from code** → P0/P1 finding');
    lines.push('- Components/databases/APIs in code but **not mentioned in docs** → P1/P2 finding');
    lines.push('- **Configuration/ownership/wiring disagreements** between docs and code → P1 finding');
    lines.push('- For each blind spot listed below, add a `BLIND-SPOT` finding');
    lines.push('');
    lines.push('---');
    lines.push('');

    let charBudget = TOTAL_DOC_CHAR_CAP;
    let truncated = 0;
    for (const doc of bundle.docs) {
      if (charBudget <= 0) { truncated++; continue; }
      const cap = Math.min(PER_DOC_CHAR_CAP, charBudget);
      const body = doc.contents.length > cap
        ? doc.contents.slice(0, cap) + `\n\n[... truncated — ${String(doc.contents.length - cap)} more chars]`
        : doc.contents;
      lines.push(`### \`${doc.relativePath}\`${doc.isBinary ? ' *(binary — filename only)*' : ''}`);
      lines.push('');
      lines.push(body);
      lines.push('');
      lines.push('---');
      lines.push('');
      charBudget -= body.length;
    }
    if (truncated > 0) {
      lines.push(`*(${String(truncated)} additional doc(s) omitted — total budget exceeded)*`);
      lines.push('');
    }
  }

  if (bundle.knownGaps.length > 0) {
    lines.push('### Known Blind Spots — Documents the User Could Not Obtain');
    lines.push('');
    lines.push('Each entry below MUST appear as a `BLIND-SPOT` finding in the Gap Report:');
    lines.push('');
    for (const gap of bundle.knownGaps) {
      lines.push(`- **${gap.title}** — ${gap.reason}${gap.owner ? ` (owner: ${gap.owner})` : ''}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// ─── File Catalog Formatters ──────────────────────────────────────────────────

function formatFileRecord(record: FileRecord): string {
  const ext = record.extraction;
  switch (ext.type) {
    case 'source': {
      const parts: string[] = [];
      if (ext.exports.length > 0)    parts.push(`exports: ${ext.exports.slice(0, 20).join(', ')}`);
      if (ext.imports.length > 0)    parts.push(`imports: ${ext.imports.slice(0, 15).join(', ')}`);
      if (ext.classes.length > 0)    parts.push(`classes: ${ext.classes.slice(0, 10).join(', ')}`);
      if (ext.decorators.length > 0) parts.push(`decorators: ${[...new Set(ext.decorators)].slice(0, 8).join(', ')}`);
      if (ext.hasDefaultExport)      parts.push('default-export');
      return `${record.path} [${record.language ?? 'source'}] — ${parts.join(' | ') || '(no symbols)'}`;
    }
    case 'schema':
      return `${record.path} [schema]\n${ext.content.slice(0, 4000)}`;
    case 'config':
      return `${record.path} [config]\n${ext.content.slice(0, 2000)}`;
    case 'docs':
      return `${record.path} [docs]\n${ext.content.slice(0, 1500)}`;
    case 'script':
      return `${record.path} [script]\n${ext.content.slice(0, 1500)}`;
    case 'env':
      return `${record.path} [env] — keys: ${ext.keys.join(', ')}${ext.hasRealValues ? ' (has values)' : ' (template only)'}`;
    case 'lockfile':
      return `${record.path} [lockfile/${ext.lockfileFormat}] — ${String(ext.dependencyCount)} deps`;
    case 'binary':
      return `${record.path} [binary] — ${ext.detectedFormat}`;
    case 'generated':
      return `${record.path} [generated${ext.generator ? `/${ext.generator}` : ''}]`;
    case 'data':
      return `${record.path} [data/${ext.detectedFormat}] — ${String(Math.round(record.sizeBytes / 1024))}KB`;
    case 'error':
      return `${record.path} [read-error: ${ext.message}]`;
    default:
      return `${record.path} [unknown]`;
  }
}

function formatSubsystemFiles(
  harvest: HarvestResult,
  prefixes: string[],
): string {
  const records = Object.values(harvest.fileRecords);
  const relevant = prefixes.length > 0
    ? records.filter(r => prefixes.some(p => r.path.startsWith(p)))
    : records;

  if (relevant.length === 0) return '(no files in subsystem)';

  // Schemas, env, configs, scripts: always included with full extraction detail. These are
  // architecturally critical (data models, secrets layout, build entry points) AND small in
  // count, so they don't threaten prompt budget.
  const schemas  = relevant.filter(r => r.extraction.type === 'schema' || r.extraction.type === 'env');
  const configs  = relevant.filter(r => r.extraction.type === 'config' || r.extraction.type === 'script');
  const sources  = relevant.filter(r => r.extraction.type === 'source');
  const others   = relevant.filter(r => !['schema', 'env', 'config', 'script', 'source'].includes(r.extraction.type));

  // Source files: bounded by import-fanout ranking. Hub files and entry points always
  // included before the cap kicks in.
  const hubSet   = new Set(harvest.importGraph.hubFiles);
  const entrySet = new Set(harvest.importGraph.entryPoints);
  const mustInclude = sources.filter(s => hubSet.has(s.path) || entrySet.has(s.path));
  const remainder   = sources.filter(s => !hubSet.has(s.path) && !entrySet.has(s.path));
  const ranked      = rankSourceRecords(remainder, harvest.importGraph.edges);

  const detailBudget = Math.max(0, SUBSYSTEM_SOURCE_DETAIL_CAP - mustInclude.length);
  const detailRanked = ranked.slice(0, detailBudget);
  const overflow     = ranked.slice(detailBudget);

  // Stable order for the detailed block: must-include first, then ranked-and-budgeted.
  const detailSources = [...mustInclude, ...detailRanked];

  const sections: string[] = [];
  if (schemas.length > 0) sections.push(`#### Schema / Env\n${schemas.map(formatFileRecord).join('\n')}`);
  if (configs.length > 0) sections.push(`#### Config / Scripts\n${configs.map(formatFileRecord).join('\n')}`);

  if (detailSources.length > 0) {
    const note = overflow.length > 0
      ? ` — top ${String(detailSources.length)} of ${String(sources.length)} by import-fanout (hubs + entry points pinned)`
      : '';
    sections.push(`#### Source Files (${String(detailSources.length)})${note}\n${detailSources.map(formatFileRecord).join('\n')}`);
  }

  // Overflow inventory: every remaining source file appears as a path so the AI sees the full
  // surface area of the subsystem and can reference any file accurately. No symbol detail.
  if (overflow.length > 0) {
    sections.push(
      `#### Additional Source Files in Subsystem (${String(overflow.length)} — paths only)\n` +
      overflow.map(r => `  ${r.path} [${r.language ?? 'source'}]`).join('\n'),
    );
  }

  if (others.length > 0) sections.push(`#### Other (${String(others.length)})\n${others.map(r => `${r.path} [${r.extraction.type}]`).join('\n')}`);

  return sections.join('\n\n');
}

function formatFileCatalogSummary(harvest: HarvestResult): string {
  const records = Object.values(harvest.fileRecords);

  const byType = {
    source:    records.filter(r => r.extraction.type === 'source').length,
    schema:    records.filter(r => r.extraction.type === 'schema').length,
    config:    records.filter(r => r.extraction.type === 'config').length,
    generated: records.filter(r => r.extraction.type === 'generated').length,
    binary:    records.filter(r => r.extraction.type === 'binary').length,
    data:      records.filter(r => r.extraction.type === 'data').length,
    error:     records.filter(r => r.extraction.type === 'error').length,
  };

  const typeBreakdown = Object.entries(byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type}:${String(count)}`)
    .join(', ');

  // Top-level directory structure
  const topDirs = new Map<string, number>();
  for (const r of records) {
    const top = r.path.split('/')[0] ?? r.path;
    topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
  }
  const dirSummary = [...topDirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => `  ${dir}/ (${String(count)} files)`)
    .join('\n');

  // Schema files — always show full content
  const schemaFiles = records.filter(r => r.extraction.type === 'schema');
  const schemaContent = schemaFiles.length > 0
    ? schemaFiles.map(formatFileRecord).join('\n\n')
    : 'None detected';

  // Hub files from import graph
  const hubSummary = harvest.importGraph.hubFiles.length > 0
    ? harvest.importGraph.hubFiles.map(f => {
        const count = harvest.importGraph.edges.filter(e => e.to === f && !e.isExternal).length;
        return `  ${f} (imported by ${String(count)} files)`;
      }).join('\n')
    : '  (none)';

  // Entry points
  const entrySummary = harvest.importGraph.entryPoints.slice(0, 20).join('\n  ') || '(none)';

  // Circular deps
  const cycleSummary = harvest.importGraph.circularCycles.length > 0
    ? harvest.importGraph.circularCycles.map(c => `  ${c.cycle.join(' → ')}`).join('\n')
    : '  None';

  return `### File Catalog (${String(harvest.meta.totalFiles)} total)
Type breakdown: ${typeBreakdown}

#### Directory Structure
${dirSummary}

#### Schema & Data Models
${schemaContent}

#### Import Graph
Hub files (imported by 5+ files):
${hubSummary}

Entry points:
  ${entrySummary}

Circular dependencies:
${cycleSummary}`;
}

// ─── Route Formatter — No Caps ────────────────────────────────────────────────

function formatAllRoutes(harvest: HarvestResult): string {
  if (harvest.apiRoutes.length === 0) return 'No API routes detected.';
  return harvest.apiRoutes
    .map(r => `  ${r.method.padEnd(7)} ${r.path.padEnd(60)} ${r.file}:${String(r.line)} auth=${String(r.authRequired)}${r.authMethod ? ` (${r.authMethod})` : ''}`)
    .join('\n');
}

function formatSubsystemRoutes(harvest: HarvestResult, prefixes: string[]): string {
  if (prefixes.length === 0) return formatAllRoutes(harvest);
  const subsystemRoutes = harvest.apiRoutes.filter(r => prefixes.some(p => r.file.startsWith(p)));
  if (subsystemRoutes.length === 0) return '(no routes in this subsystem)';
  return subsystemRoutes
    .map(r => `  ${r.method.padEnd(7)} ${r.path.padEnd(60)} ${r.file}:${String(r.line)} auth=${String(r.authRequired)}`)
    .join('\n');
}

// ─── Other Formatters ─────────────────────────────────────────────────────────

function formatDeps(harvest: HarvestResult): string {
  const all  = harvest.dependencies.flatMap(m => m.dependencies);
  const prod = all.filter(d => !d.isDev);
  const dev  = all.filter(d =>  d.isDev);
  const fmt  = (ds: typeof prod) => ds.map(d => `  ${d.name}@${d.version}`).join('\n') || '  (none)';
  return `Production (${String(prod.length)}):\n${fmt(prod)}\nDev (${String(dev.length)}):\n${fmt(dev)}`;
}

function formatEnvVars(harvest: HarvestResult): string {
  const secrets = harvest.envVars.filter(v =>  v.isSecret);
  const plain   = harvest.envVars.filter(v => !v.isSecret);
  const fmtEnv  = (vs: typeof secrets) => vs.map(v => `  ${v.name}${v.inferredPurpose ? ` — ${v.inferredPurpose}` : ''}`).join('\n') || '  (none)';
  return `Secrets (${String(secrets.length)}):\n${fmtEnv(secrets)}\nPublic (${String(plain.length)}):\n${fmtEnv(plain)}`;
}

function formatPhiCandidates(harvest: HarvestResult): string {
  if (harvest.piiCandidateLocations.length === 0) return 'None detected.';
  return harvest.piiCandidateLocations
    .map(p => `  ${p.file} lines ${String(p.lineStart)}–${String(p.lineEnd)} — ${p.hint}`)
    .join('\n');
}

function formatCiCd(harvest: HarvestResult): string {
  const { cicd } = harvest;
  const parts: string[] = [];
  if (cicd.docker.hasDockerfile)     parts.push('Dockerfile');
  if (cicd.docker.hasCompose)        parts.push('docker-compose');
  if (cicd.kubernetes)               parts.push('Kubernetes');
  if (cicd.helm)                     parts.push('Helm');
  if (cicd.githubActions.length > 0) parts.push(`GitHub Actions (${String(cicd.githubActions.length)} workflows)`);
  if (cicd.makefile.present)         parts.push(`Makefile (${cicd.makefile.targets.slice(0, 5).join(', ')})`);
  if (cicd.deploymentTargets.length > 0) parts.push(`Targets: ${cicd.deploymentTargets.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : 'No CI/CD detected';
}

function formatMonorepo(harvest: HarvestResult): string {
  if (!harvest.framework.isMonorepo || harvest.monorepoPackages.length === 0) return '';
  const pkgs = harvest.monorepoPackages
    .map(p => `  ${p.name || '(unnamed)'} → ${p.path}`)
    .join('\n');
  return `### Monorepo Packages (${String(harvest.monorepoPackages.length)})\n${pkgs}\n`;
}

function formatAuth(harvest: HarvestResult): string {
  if (harvest.auth.patterns.length === 0) return 'No auth patterns detected.';
  return harvest.auth.patterns
    .map(p => `  ${p.type} — key files: ${p.keyFiles.join(', ')} — covers all routes: ${String(p.coversAllRoutes)}`)
    .join('\n');
}

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return `You are Geodesic, an AI-powered codebase topology analyst producing jaw-dropping, hyper-accurate architectural analysis.

PII COMPLIANCE: All harvest data has been scrubbed. Tokens like [PHI:PERSON_NAME:ref:a3f2:CONF:HIGH] are compliance placeholders — never include them in output. Reference them as "[PHI token]" when describing data flows.

ACCURACY STANDARD: Every claim must be grounded in the harvest data provided. Reference exact file paths and line numbers. Missing a significant architectural element is a failure. If you see it in the data, it goes in the output.

SCORING RULES (for gap reports):
- Scores: integers 0–100. Findings reduce from 100, floor at 0.
- P0=−30 to −40, P1=−15 to −25, P2=−5 to −15, P3=−1 to −5
- Compliance active:true only if PHI fields detected in harvest
- Overall = weighted avg: Security 25%, Compliance 20%, Testability 15%, Observability 15%, Maintainability 15%, Documentation 5%, Scalability 5%
- Grades: A=90–100, B=75–89, C=60–74, D=40–59, F=0–39
- Grade harshly. Real gaps are real findings. Every finding needs a real file path and line range.

Follow the output format specified in each request exactly.`;
}

// ─── Stage 1: Discovery ───────────────────────────────────────────────────────

export function buildDiscoveryPrompt(harvest: HarvestResult): string {
  const subsystemCount = Math.min(8, Math.max(3, Math.ceil(harvest.apiRoutes.length / 15)));

  const records = Object.values(harvest.fileRecords);
  const topDirs = new Map<string, number>();
  for (const r of records) {
    const top = r.path.split('/')[0] ?? r.path;
    topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
  }
  const dirList = [...topDirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => `  ${dir}/ (${String(count)} files)`)
    .join('\n');

  return `Analyze this codebase and identify its logical subsystems for deep analysis.

Stack: ${harvest.languages.primary}/${harvest.framework.primary ?? 'unknown'}${harvest.framework.isMonorepo ? ` (monorepo, ${String(harvest.monorepoPackages.length)} packages)` : ''}
Total files: ${String(harvest.meta.totalFiles)} | Routes: ${String(harvest.apiRoutes.length)} | Tests: ${String(harvest.tests.testFileCount)}
Auth: ${harvest.auth.patterns.map(p => p.type).join(' + ') || 'none'} | DB: ${harvest.databases.engines.join(', ') || 'none'} | ORM: ${harvest.databases.orm ?? 'none'}
PHI candidates: ${String(harvest.piiCandidateLocations.length)}
CI/CD: ${formatCiCd(harvest)}

${formatMonorepo(harvest)}
### Top-level Directory Structure
${dirList}

### Hub Files (architectural anchors)
${harvest.importGraph.hubFiles.slice(0, 15).join('\n') || '(none detected)'}

### Entry Points
${harvest.importGraph.entryPoints.slice(0, 10).join('\n') || '(none detected)'}

Identify ${String(subsystemCount - 2)}–${String(subsystemCount)} logical subsystems. Use exact directory prefixes that appear in the structure above. Prioritize by risk and architectural importance.

Respond with ONLY this JSON (no markdown, no explanation):
{
  "context": "one paragraph describing overall architecture and design philosophy",
  "subsystems": [
    { "name": "string", "priority": 1, "filePrefixes": ["exact/prefix"], "focusAreas": ["specific things to analyze"] }
  ]
}`;
}

// ─── Stage 2: Deep Dive ───────────────────────────────────────────────────────

export function buildDeepDivePrompt(
  subsystemName: string,
  focusAreas: string[],
  harvest: HarvestResult,
  discoveryContext: string,
): string {
  const prefixes = harvest.importGraph.hubFiles.length > 0
    ? [] // If called with empty prefixes in engine, use full harvest
    : [];

  return buildDeepDivePromptWithPrefixes(subsystemName, focusAreas, prefixes, harvest, discoveryContext);
}

export function buildDeepDivePromptWithPrefixes(
  subsystemName: string,
  focusAreas: string[],
  filePrefixes: string[],
  harvest: HarvestResult,
  discoveryContext: string,
): string {
  const subsystemFiles = formatSubsystemFiles(harvest, filePrefixes);
  const subsystemRoutes = formatSubsystemRoutes(harvest, filePrefixes);

  // Cross-package import edges involving this subsystem
  const relevantEdges = harvest.importGraph.edges.filter(e =>
    !e.isExternal && (
      filePrefixes.some(p => e.from.startsWith(p)) ||
      filePrefixes.some(p => e.to.startsWith(p))
    ),
  );
  const crossPkgEdges = relevantEdges.filter(e => e.isCrossPackage);
  const crossPkgSummary = crossPkgEdges.length > 0
    ? crossPkgEdges.map(e => `  ${e.from} → ${e.to}`).join('\n')
    : '  (none)';

  // Circular deps in this subsystem
  const subsystemCycles = harvest.importGraph.circularCycles.filter(c =>
    filePrefixes.length === 0 || c.cycle.some(f => filePrefixes.some(p => f.startsWith(p))),
  );

  return `## Deep Analysis: ${subsystemName}

### Architecture Context
${discoveryContext || '(synthesize from file catalog)'}

### Focus Areas
${focusAreas.length > 0 ? focusAreas.map(f => `- ${f}`).join('\n') : '- General analysis'}

### File Catalog for This Subsystem
${subsystemFiles}

### API Routes in This Subsystem (${String(subsystemRoutes.split('\n').filter(l => l.trim()).length)})
${subsystemRoutes}

### Cross-Package Dependencies
${crossPkgSummary}

### Circular Dependencies in Subsystem
${subsystemCycles.length > 0
  ? subsystemCycles.map(c => `  ${c.cycle.join(' → ')}`).join('\n')
  : '  None'}

### Auth Patterns
${formatAuth(harvest)}

### PHI Candidates Touching This Subsystem
${harvest.piiCandidateLocations.filter(p =>
    filePrefixes.length === 0 || filePrefixes.some(prefix => p.file.startsWith(prefix)),
  ).map(p => `  ${p.file}:${String(p.lineStart)}–${String(p.lineEnd)} — ${p.hint}`).join('\n') || '  None'}

---

Produce a comprehensive markdown analysis of the **${subsystemName}** subsystem. You have the complete file catalog above — reference every significant file by exact path. Cover:

1. **Architecture & Design Patterns** — layers, responsibilities, key files, data flow
2. **Security Posture** — auth coverage, input validation, secrets handling, injection risks
3. **HIPAA / Compliance** — PHI data flows, access controls, audit logging
4. **Quality** — test coverage gaps, error handling patterns, observability
5. **P0–P3 Findings** — specific, actionable, with exact file path and line range

Do not generalize. Every finding must reference a specific file from the catalog above.`;
}

// ─── Stage 3: Artifacts ───────────────────────────────────────────────────────

const SUBSYSTEM_CAP = 4_000;

function buildSharedContext(
  harvest: HarvestResult,
  crystal: Crystal | null,
  meta: { crystalMatchScore: number | null },
  analyses: Array<{ name: string; analysis: string; status: 'deep' | 'shallow' }>,
  discoveryContext: string,
): string {
  const shallowNames = analyses.filter(a => a.status === 'shallow').map(a => a.name);
  const shallowNote  = shallowNames.length > 0
    ? `> **Note:** Raw harvest fallback for: ${shallowNames.join(', ')} — limited data for those areas.\n\n`
    : '';

  const crystalSection = crystal
    ? `### Crystal Bootstrap (${String(Math.round((meta.crystalMatchScore ?? 0) * 100))}% stack match)\n${crystal.bootstrapPrompt}\n`
    : '';

  const subsystemSections = analyses.map(a => {
    const body = a.analysis.length > SUBSYSTEM_CAP
      ? a.analysis.slice(0, SUBSYSTEM_CAP) + `\n… (${String(a.analysis.length - SUBSYSTEM_CAP)} chars — see deep dive)`
      : a.analysis;
    return `### ${a.name}${a.status === 'shallow' ? ' *(raw harvest)*' : ''}\n\n${body}`;
  }).join('\n\n---\n\n');

  return `${shallowNote}### Architecture Overview
${discoveryContext || '(see subsystem analyses)'}

### Harvest Summary
- Repo: ${harvest.meta.repoName} @ ${harvest.meta.repoCommit ?? 'unknown'}
- Files: ${String(harvest.meta.totalFiles)} total | ${String(harvest.meta.binaryFiles)} binary | ${String(harvest.meta.generatedFiles)} generated | ${String(harvest.meta.errorFiles)} errors
- Languages: ${harvest.languages.all.map(l => `${l.language}(${String(l.fileCount)})`).join(', ')}
- Framework: ${harvest.framework.primary ?? 'unknown'} | Monorepo: ${String(harvest.framework.isMonorepo)}
- Routes: ${String(harvest.apiRoutes.length)} | Auth: ${harvest.auth.patterns.map(p => p.type).join(' + ') || 'none'}
- DB: ${harvest.databases.engines.join(', ') || 'none'} | ORM: ${harvest.databases.orm ?? 'none'} | Migrations: ${String(harvest.databases.migrationCount)}
- Tests: ${String(harvest.tests.testFileCount)} (${harvest.tests.frameworks.join(', ') || 'none'})
- PHI candidates: ${String(harvest.piiCandidateLocations.length)}
- CI/CD: ${formatCiCd(harvest)}

${formatMonorepo(harvest)}
${crystalSection}
## Subsystem Deep-Dive Analyses

${subsystemSections}`;
}

export function buildArchMapPrompt(
  harvest: HarvestResult,
  crystal: Crystal | null,
  meta: { crystalMatchScore: number | null },
  analyses: Array<{ name: string; analysis: string; status: 'deep' | 'shallow' }>,
  discoveryContext: string,
  transitionDocs: IngestedDocsBundle | null = null,
): string {
  return `${formatTransitionDocs(transitionDocs)}${buildSharedContext(harvest, crystal, meta, analyses, discoveryContext)}

---

${formatFileCatalogSummary(harvest)}

### Complete Route Inventory (${String(harvest.apiRoutes.length)} total — ALL routes, no omissions)
${formatAllRoutes(harvest)}

### All Dependencies
${formatDeps(harvest)}

### All Environment Variables
${formatEnvVars(harvest)}

### CI/CD & Infrastructure Detail
${formatCiCd(harvest)}
${harvest.cicd.githubActions.map(w => `  Workflow: ${w.name} (${w.file}) — triggers: ${w.triggers.join(', ')}`).join('\n')}

---

Produce a comprehensive **Architecture Map** in markdown for **${harvest.meta.repoName}**.

Requirements:
- Every route in the inventory above must appear
- Every package in the monorepo must appear
- Every layer of the application must be described with key files
- Every external service, database, and auth boundary must appear
- Every hub file must be called out
- Every circular dependency must be flagged
- PHI zones must be marked with exact file and line coordinates
- Use exact file paths — never say "in the auth folder", say "in src/auth/jwt-middleware.ts"

Return raw markdown only — no code fences, no wrapper.`;
}

export function buildSkillFileNarrativePrompt(
  harvest: HarvestResult,
  analyses: Array<{ name: string; analysis: string; status: 'deep' | 'shallow' }>,
  discoveryContext: string,
): string {
  const topDirs = new Map<string, number>();
  for (const r of Object.values(harvest.fileRecords)) {
    const top = r.path.split('/')[0] ?? r.path;
    topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
  }
  const dirList = [...topDirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => `  ${dir}/ (${String(count)} files)`)
    .join('\n');

  const analysisSummary = analyses
    .map(a => `### ${a.name}\n${a.analysis.slice(0, 600)}`)
    .join('\n\n');

  // Compact fields first — if output is truncated, we still have the highest-value data.
  // topology.layers is last and capped because large monorepos can generate 20+ entries.
  const schema = `{"patterns":{"authFlow":"","errorHandling":"","testingApproach":"","logging":"","apiVersioning":null,"rateLimiting":null},"devHooks":{"addApiRoute":"","addDbModel":"","addMigration":"","addTest":"","addMiddleware":"","addEnvVar":""},"constraints":{"knownQuirks":[],"breakingChangeRisks":[],"techDebtHotspots":[]},"infra":{"orchestration":null,"hasMonitoring":false},"apis":{"external":[{"service":"","baseUrlPattern":"","authMethod":"","filesReferencing":[]}],"webhooks":[{"path":"","provider":"","file":"","line":0,"verified":false}]},"topology":{"layers":[{"name":"","path":"","responsibility":"","keyFiles":[]}]}}`;

  return `Repository: ${harvest.meta.repoName}
Stack: ${harvest.languages.primary} | Framework: ${harvest.framework.primary ?? 'unknown'} | DB: ${harvest.databases.engines.join(', ') || 'none'} | ORM: ${harvest.databases.orm ?? 'none'}
Auth: ${harvest.auth.patterns.map(p => p.type).join(', ') || 'unknown'} | Tests: ${String(harvest.tests.testFileCount)} files (${harvest.tests.frameworks.join(', ') || 'unknown'})
CI/CD: ${formatCiCd(harvest)}
${harvest.framework.isMonorepo ? `Monorepo packages: ${harvest.monorepoPackages.map(p => p.name || p.path).join(', ')}\n` : ''}
Top-level directories:
${dirList}
${discoveryContext ? `\nContext: ${discoveryContext}` : ''}

Subsystem analyses (excerpts):
${analysisSummary}

---

Produce ONLY this narrative patch as minified JSON. Each string: 1–2 sentences, codebase-specific.
Output fields IN ORDER as shown — most important first.
- patterns: describe auth/errors/tests/logging as they actually work here
- devHooks: concrete file-level instructions for THIS codebase (e.g. "Add handler to packages/server/src/routes/")
- constraints: real quirks and risks from the analysis
- infra.hasMonitoring: true only if prometheus/datadog/cloudwatch/etc found
- apis.external: external HTTP services this codebase calls (not its own routes)
- apis.webhooks: inbound webhook paths (leave empty array if none)
- topology.layers: max 10 entries for the most important directories, max 3 keyFiles each

Schema:
${schema}

Return JSON only — no markdown, no code fences, no explanation.`;
}

export function buildGapReportPrompt(
  harvest: HarvestResult,
  analyses: Array<{ name: string; analysis: string; status: 'deep' | 'shallow' }>,
  discoveryContext: string,
  transitionDocs: IngestedDocsBundle | null = null,
): string {
  const repoName = harvest.meta.repoName;

  const unprotectedRoutes = harvest.apiRoutes.filter(r => !r.authRequired);
  const protectedRoutes   = harvest.apiRoutes.filter(r =>  r.authRequired);

  const schema = `GapReport schema:
{
  "repoName": "${repoName}",
  "analyzedAt": "ISO",
  "overallScore": 0,
  "overallGrade": "F",
  "dimensions": [
    { "dimension": "Security", "score": 0, "grade": "F", "active": true, "findings": [{"severity":"P0","dimension":"Security","description":"","file":"","lineStart":0,"lineEnd":0,"detail":"","fix":"","deduction":0}] },
    { "dimension": "Compliance", "score": 0, "grade": "F", "active": false, "findings": [] },
    { "dimension": "Testability", "score": 0, "grade": "F", "active": true, "findings": [] },
    { "dimension": "Observability", "score": 0, "grade": "F", "active": true, "findings": [] },
    { "dimension": "Maintainability", "score": 0, "grade": "F", "active": true, "findings": [] },
    { "dimension": "Documentation", "score": 0, "grade": "F", "active": true, "findings": [] },
    { "dimension": "Scalability", "score": 0, "grade": "F", "active": true, "findings": [] }
  ],
  "uncertainDetections": [],
  "recommendedPathForward": ""
}`;

  return `${formatTransitionDocs(transitionDocs)}${buildSharedContext(harvest, null, { crystalMatchScore: null }, analyses, discoveryContext)}

---

### Complete Route Inventory
Auth coverage: ${String(protectedRoutes.length)}/${String(harvest.apiRoutes.length)} routes protected
Unprotected routes (${String(unprotectedRoutes.length)}):
${unprotectedRoutes.map(r => `  ${r.method} ${r.path} — ${r.file}:${String(r.line)}`).join('\n') || '  (none)'}

All routes:
${formatAllRoutes(harvest)}

### PHI Candidate Locations (ALL must be assessed for Compliance dimension)
${formatPhiCandidates(harvest)}

### All Environment Variables
${formatEnvVars(harvest)}

### Circular Dependencies (flag in Maintainability)
${harvest.importGraph.circularCycles.length > 0
  ? harvest.importGraph.circularCycles.map(c => `  ${c.cycle.join(' → ')}`).join('\n')
  : '  None'}

---

Scoring rules:
- P0=−30 to −40, P1=−15 to −25, P2=−5 to −15, P3=−1 to −5
- Compliance: active:true only if PHI fields detected
- Overall = weighted avg: Security 25%, Compliance 20%, Testability 15%, Observability 15%, Maintainability 15%, Documentation 5%, Scalability 5%
- Grades: A=90–100, B=75–89, C=60–74, D=40–59, F=0–39
- Every finding: real file path, real line range from harvest data — no invented locations

${schema}

Produce the complete **GapReport** for **${repoName}** as minified JSON.
- Every unprotected route is a candidate Security finding
- Every PHI candidate is a candidate Compliance finding
- Every circular dependency is a Maintainability finding
- Pull ALL findings from the subsystem analyses — omitting a finding is a failure
- recommendedPathForward must be a concrete, actionable paragraph

Return JSON only — no markdown, no code fences, no explanation.`;
}

// ─── Raw Harvest Fallback ─────────────────────────────────────────────────────

export function buildRawFallbackSummary(subsystemName: string, harvest: HarvestResult): string {
  const routes = harvest.apiRoutes.map(r => `${r.method} ${r.path} (${r.file})`).join('\n') || 'none';
  const deps   = harvest.dependencies.flatMap(m => m.dependencies.map(d => d.name)).slice(0, 20).join(', ') || 'none';
  const phi    = harvest.piiCandidateLocations.map(p => `${p.file}:${String(p.lineStart)}`).join(', ') || 'none';
  const files  = Object.keys(harvest.fileRecords).slice(0, 30).join('\n') || 'none';
  return `## ${subsystemName} — Raw Harvest Fallback (deep analysis unavailable)

### Files (sample)
${files}

### Routes
${routes}

### Dependencies
${deps}

### PHI candidates
${phi}`;
}

// ─── Legacy ───────────────────────────────────────────────────────────────────

export function buildSynthesisPrompt(
  harvest: HarvestResult,
  crystal: Crystal | null,
  meta: {
    analystId: string; repo: string; repoCommit: string;
    crystalId: string | null; crystalMatchScore: number | null;
    provider: string; model: string;
  },
): string {
  const crystalSection = crystal
    ? `### Crystal Bootstrap (${String(Math.round((meta.crystalMatchScore ?? 0) * 100))}% match)\n${crystal.bootstrapPrompt}`
    : '### Crystal Bootstrap\nCold-start.';

  return `## Repository: ${harvest.meta.repoName}
Commit: ${meta.repoCommit}

### Stack
- Language: ${harvest.languages.primary} | Framework: ${harvest.framework.primary ?? 'unknown'}
- ORM: ${harvest.databases.orm ?? 'none'} | Auth: ${harvest.auth.patterns[0]?.type ?? 'unknown'}
- DB: ${harvest.databases.engines.join(', ') || 'none'} | Migrations: ${String(harvest.databases.migrationCount)}
- Tests: ${String(harvest.tests.testFileCount)} (${harvest.tests.frameworks.join(', ') || 'unknown'})

${formatFileCatalogSummary(harvest)}

### All Routes (${String(harvest.apiRoutes.length)})
${formatAllRoutes(harvest)}

### Dependencies
${formatDeps(harvest)}

### Environment Variables
${formatEnvVars(harvest)}

### CI/CD
${formatCiCd(harvest)}

### PHI Candidates
${formatPhiCandidates(harvest)}

${crystalSection}`;
}

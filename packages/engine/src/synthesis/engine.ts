import type { HarvestResult, Crystal, SynthesisResult, AIProvider, SkillFileJson, IngestedDocsBundle } from '@geodesic/types';
import {
  buildSystemPrompt,
  buildDiscoveryPrompt,
  buildDeepDivePromptWithPrefixes,
  buildArchMapPrompt,
  buildSkillFileNarrativePrompt,
  buildGapReportPrompt,
  buildRawFallbackSummary,
} from './prompt-builder.js';
import { parseSynthesisResponse } from './response-parser.js';
import { assembleSkillFile, type SkillFileNarrativePatch } from './skill-file-builder.js';

const DISCOVERY_TIMEOUT_MS =        60_000; // 1 min — cheap structural call
const DEEP_DIVE_TIMEOUT_MS =    5 * 60_000; // 5 min — per subsystem
const ARTIFACT_TIMEOUT_MS  =   10 * 60_000; // 10 min — per artifact (parallel, large repos need room)
const DEEP_DIVE_CONCURRENCY = 2;
const MAX_SUBSYSTEMS = 8;

// Output token budgets
const DEEP_DIVE_MAX_TOKENS         = 8_000;
const ARTIFACT_MAX_TOKENS          = 32_000; // arch-map and gap-report prose
const SKILL_FILE_NARRATIVE_TOKENS  = 6_000;  // narrative patch only — structural data comes from harvest

export const OVERALL_ANALYSIS_TIMEOUT_MS = 60 * 60_000;

// ─── Utilities ────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => { reject(new Error(`${label} timed out after ${String(Math.round(ms / 1000 / 60))} min`)); },
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, limit: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item !== undefined) results[i] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubsystemSpec {
  name: string;
  priority: number;
  filePrefixes: string[];
  focusAreas: string[];
}

interface SubsystemResult {
  name: string;
  analysis: string;
  tokensUsed: number;
  status: 'deep' | 'shallow';
}

// Structured events that map cleanly onto the pipeline's phase tree. Less ambiguous
// than parsing onProgress strings — the pipeline switches on `event.type` and updates
// the corresponding phase / subtask without string matching.
export type SynthesisPhaseEvent =
  | { type: 'discovery_started' }
  | { type: 'discovery_complete'; subsystemCount: number; subsystemNames: string[]; subsystems: Array<{ id: string; name: string }> }
  | { type: 'deep_dive_started'; subsystemId: string; name: string }
  | { type: 'deep_dive_complete'; subsystemId: string; name: string; status: 'deep' | 'shallow'; completed: number; total: number }
  | { type: 'deep_dives_complete'; total: number }
  | { type: 'artifacts_complete' };

export interface SynthesisOptions {
  harvest: HarvestResult;
  crystal: Crystal | null;
  crystalMatchScore: number | null;
  provider: AIProvider;
  echoProvider: AIProvider;
  analystId: string;
  repo: string;
  repoCommit: string;
  onWarning?: (msg: string) => void;
  onProgress?: (msg: string) => void;
  onPhaseEvent?: (event: SynthesisPhaseEvent) => void;
  transitionDocs?: IngestedDocsBundle | null;
}

type ArtifactMeta = {
  analystId: string;
  repo: string;
  repoCommit: string;
  crystalId: string | null;
  crystalMatchScore: number | null;
  provider: string;
  model: string;
};

// ─── Harvest Slicing ──────────────────────────────────────────────────────────

function sliceByPrefixes(harvest: HarvestResult, prefixes: string[]): HarvestResult {
  if (prefixes.length === 0) return harvest;
  const hit = (file: string) => prefixes.some(p => file.startsWith(p));

  // Slice fileRecords to subsystem paths only
  const slicedFileRecords: typeof harvest.fileRecords = {};
  for (const [path, record] of Object.entries(harvest.fileRecords)) {
    if (hit(path)) slicedFileRecords[path] = record;
  }

  // Slice import graph edges to those involving this subsystem
  const slicedEdges = harvest.importGraph.edges.filter(e => hit(e.from) || hit(e.to));
  const slicedCycles = harvest.importGraph.circularCycles.filter(c =>
    c.cycle.some(f => hit(f)),
  );

  return {
    ...harvest,
    fileRecords:           slicedFileRecords,
    apiRoutes:             harvest.apiRoutes.filter(r => hit(r.file)),
    piiCandidateLocations: harvest.piiCandidateLocations.filter(p => hit(p.file)),
    dependencies:          harvest.dependencies.filter(d => hit(d.file)),
    envVars:               harvest.envVars.filter(e => hit(e.file)),
    importGraph: {
      ...harvest.importGraph,
      edges: slicedEdges,
      circularCycles: slicedCycles,
    },
  };
}

// ─── Stage 1: Discovery ───────────────────────────────────────────────────────

function parseDiscovery(raw: string): { subsystems: SubsystemSpec[]; context: string } {
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const text = jsonMatch?.[1] ?? raw.trim();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const context = typeof parsed['context'] === 'string' ? parsed['context'] : '';
    const subs: SubsystemSpec[] = (Array.isArray(parsed['subsystems']) ? parsed['subsystems'] : [])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .filter(s => typeof s['name'] === 'string' && typeof s['priority'] === 'number')
      .map(s => ({
        name:         s['name'] as string,
        priority:     s['priority'] as number,
        filePrefixes: (Array.isArray(s['filePrefixes']) ? s['filePrefixes'] : []).filter((x): x is string => typeof x === 'string'),
        focusAreas:   (Array.isArray(s['focusAreas'])   ? s['focusAreas']   : []).filter((x): x is string => typeof x === 'string'),
      }))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, MAX_SUBSYSTEMS);
    return { subsystems: subs, context };
  } catch {
    return { subsystems: [], context: '' };
  }
}

async function runDiscovery(
  harvest: HarvestResult,
  echoProvider: AIProvider,
  systemPrompt: string,
): Promise<{ subsystems: SubsystemSpec[]; context: string; tokensUsed: number }> {
  try {
    const result = await withTimeout(
      echoProvider.complete(
        [{ role: 'user', content: buildDiscoveryPrompt(harvest) }],
        { maxTokens: 1500, temperature: 0.1, systemPrompt },
      ),
      DISCOVERY_TIMEOUT_MS,
      'discovery',
    );
    const parsed = parseDiscovery(result.content);
    if (parsed.subsystems.length > 0) {
      process.stderr.write(`[geodesic] discovery: ${String(parsed.subsystems.length)} subsystems\n`);
      return { ...parsed, tokensUsed: result.inputTokens + result.outputTokens };
    }
  } catch (err) {
    process.stderr.write(`[geodesic] discovery failed (${err instanceof Error ? err.message : String(err)}) — single-subsystem fallback\n`);
  }
  return {
    subsystems: [{ name: 'Full Codebase', priority: 1, filePrefixes: [], focusAreas: [] }],
    context: '',
    tokensUsed: 0,
  };
}

// ─── Stage 2: Deep Dives ──────────────────────────────────────────────────────

async function analyzeSubsystem(
  spec: SubsystemSpec,
  harvest: HarvestResult,
  discoveryContext: string,
  provider: AIProvider,
  systemPrompt: string,
  onProgress?: (msg: string) => void,
): Promise<SubsystemResult> {
  const slice = sliceByPrefixes(harvest, spec.filePrefixes);
  const prompt = buildDeepDivePromptWithPrefixes(spec.name, spec.focusAreas, spec.filePrefixes, slice, discoveryContext);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await withTimeout(
        provider.complete([{ role: 'user', content: prompt }], { maxTokens: DEEP_DIVE_MAX_TOKENS, temperature: 0.1, systemPrompt }),
        DEEP_DIVE_TIMEOUT_MS,
        `deep-dive: ${spec.name} (attempt ${String(attempt)})`,
      );
      onProgress?.(`Analyzed: ${spec.name}`);
      process.stderr.write(`[geodesic] deep-dive "${spec.name}": complete\n`);
      return { name: spec.name, analysis: result.content, tokensUsed: result.inputTokens + result.outputTokens, status: 'deep' };
    } catch (err) {
      process.stderr.write(`[geodesic] deep-dive "${spec.name}" attempt ${String(attempt)} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  onProgress?.(`Analyzed: ${spec.name} (summary fallback)`);
  process.stderr.write(`[geodesic] deep-dive "${spec.name}": raw fallback\n`);
  return { name: spec.name, analysis: buildRawFallbackSummary(spec.name, slice), tokensUsed: 0, status: 'shallow' };
}

// ─── Narrative JSON Repair ────────────────────────────────────────────────────
// Salvages partial results when the LLM truncates the JSON mid-output.
// Scans forward tracking nesting depth; finds the last top-level comma (depth==1),
// truncates there, closes the root object, and tries to parse.

function parseNarrativePatch(text: string): SkillFileNarrativePatch | null {
  if (!text) return null;

  // Full parse first
  try { return JSON.parse(text) as SkillFileNarrativePatch; } catch { /* fall through to repair */ }

  // O(n) scan: track nesting depth to find last safe top-level separator
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastSafeCommaPos = -1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (escape)           { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"')        { inString = !inString; continue; }
    if (inString)         continue;
    if (c === '{' || c === '[') { depth++; continue; }
    if (c === '}' || c === ']') { depth--; continue; }
    if (c === ',' && depth === 1) lastSafeCommaPos = i;
  }

  if (lastSafeCommaPos < 1) return null;

  try {
    const partial = JSON.parse(text.slice(0, lastSafeCommaPos) + '}') as SkillFileNarrativePatch;
    process.stderr.write('[geodesic] skill-file: narrative was truncated — partial patch recovered\n');
    return partial;
  } catch {
    return null;
  }
}

// ─── Stage 3: Artifacts (parallel) ───────────────────────────────────────────

async function runArtifacts(
  harvest: HarvestResult,
  crystal: Crystal | null,
  meta: ArtifactMeta,
  results: SubsystemResult[],
  discoveryContext: string,
  provider: AIProvider,
  systemPrompt: string,
  transitionDocs: IngestedDocsBundle | null,
): Promise<{ archMap: string; skillFile: SkillFileJson; gapReport: string; tokensUsed: number }> {
  const analyses = results.map(r => ({ name: r.name, analysis: r.analysis, status: r.status }));

  process.stderr.write('[geodesic] integration: arch-map, skill-file narrative, gap-report in parallel…\n');

  const largeCall  = (content: string, label: string) => withTimeout(
    provider.complete([{ role: 'user', content }], { maxTokens: ARTIFACT_MAX_TOKENS, temperature: 0.1, systemPrompt }),
    ARTIFACT_TIMEOUT_MS,
    label,
  );
  const smallCall  = (content: string, label: string) => withTimeout(
    provider.complete([{ role: 'user', content }], { maxTokens: SKILL_FILE_NARRATIVE_TOKENS, temperature: 0.1, systemPrompt }),
    ARTIFACT_TIMEOUT_MS,
    label,
  );

  const [archMapResult, narrativeResult, gapReportResult] = await Promise.all([
    largeCall(buildArchMapPrompt(harvest, crystal, meta, analyses, discoveryContext, transitionDocs), 'arch-map'),
    smallCall(buildSkillFileNarrativePrompt(harvest, analyses, discoveryContext),     'skill-file-narrative'),
    largeCall(buildGapReportPrompt(harvest, analyses, discoveryContext, transitionDocs),              'gap-report'),
  ]);

  // Parse the narrative patch — attempt full parse, then repair truncated JSON, then empty patch
  let narrativePatch: SkillFileNarrativePatch = {};
  {
    const cleaned = narrativeResult.content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    const repaired = parseNarrativePatch(cleaned);
    if (repaired !== null) {
      narrativePatch = repaired;
      process.stderr.write('[geodesic] skill-file: narrative patch applied\n');
    } else {
      process.stderr.write('[geodesic] skill-file: narrative parse failed — using empty patch\n');
    }
  }

  const skillFile = assembleSkillFile(harvest, {
    analystId:        meta.analystId,
    repo:             meta.repo,
    repoCommit:       meta.repoCommit,
    crystalId:        meta.crystalId,
    crystalMatchScore: meta.crystalMatchScore,
    analysisDurationMs: 0, // patched in parseSynthesisResponse
    provider:         meta.provider,
    model:            meta.model,
  }, narrativePatch);

  const tokensUsed =
    archMapResult.inputTokens  + archMapResult.outputTokens  +
    narrativeResult.inputTokens + narrativeResult.outputTokens +
    gapReportResult.inputTokens + gapReportResult.outputTokens;

  return { archMap: archMapResult.content, skillFile, gapReport: gapReportResult.content, tokensUsed };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

// Stable, deterministic ID for a subsystem subtask (used by the pipeline to track
// which subsystem is currently running in the deep-dives phase tree).
function subsystemSubtaskId(name: string, index: number): string {
  // Slug + index disambiguates if two subsystems share a name (rare, but possible).
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `dd-${String(index)}-${slug}`;
}

export async function synthesize(options: SynthesisOptions): Promise<SynthesisResult> {
  const { harvest, crystal, crystalMatchScore, provider, echoProvider, analystId, repo, repoCommit, onWarning, onProgress, onPhaseEvent, transitionDocs } = options;
  const startedAt = Date.now();
  const crystalId = crystal?.crystalId ?? null;
  const meta: ArtifactMeta = { analystId, repo, repoCommit, crystalId, crystalMatchScore, provider: provider.name, model: provider.defaultModel };
  const systemPrompt = buildSystemPrompt();

  // Stage 1 — Discovery
  onProgress?.('AI Discovery: mapping subsystem boundaries…');
  onPhaseEvent?.({ type: 'discovery_started' });
  process.stderr.write('[geodesic] synthesis 1/3: discovery…\n');
  const discovery = await runDiscovery(harvest, echoProvider, systemPrompt);
  let totalTokens = discovery.tokensUsed;

  const subsystemEntries = discovery.subsystems.map((s, i) => ({
    spec: s,
    id: subsystemSubtaskId(s.name, i),
  }));
  const subsystemList = discovery.subsystems.map(s => s.name).join(', ');
  onProgress?.(`Discovery complete: ${String(discovery.subsystems.length)} subsystems — ${subsystemList}`);
  onPhaseEvent?.({
    type: 'discovery_complete',
    subsystemCount: discovery.subsystems.length,
    subsystemNames: discovery.subsystems.map(s => s.name),
    subsystems: subsystemEntries.map(e => ({ id: e.id, name: e.spec.name })),
  });

  // Stage 2 — Deep Dives
  const total = subsystemEntries.length;
  let completed = 0;
  process.stderr.write(`[geodesic] synthesis 2/3: deep dives (${String(total)} subsystems)…\n`);

  const deepResults = await pMap(
    subsystemEntries,
    async (entry) => {
      onPhaseEvent?.({ type: 'deep_dive_started', subsystemId: entry.id, name: entry.spec.name });
      onProgress?.(`Deep dive: ${entry.spec.name}`);
      const result = await analyzeSubsystem(entry.spec, harvest, discovery.context, provider, systemPrompt, onProgress);
      completed++;
      onPhaseEvent?.({
        type: 'deep_dive_complete',
        subsystemId: entry.id,
        name: entry.spec.name,
        status: result.status,
        completed,
        total,
      });
      return result;
    },
    DEEP_DIVE_CONCURRENCY,
  );
  totalTokens += deepResults.reduce((s, r) => s + r.tokensUsed, 0);
  onPhaseEvent?.({ type: 'deep_dives_complete', total });

  const shallowCount = deepResults.filter(r => r.status === 'shallow').length;
  if (shallowCount > 0) {
    const msg = `${String(shallowCount)} subsystem(s) fell back to raw harvest — deep analysis unavailable for those areas`;
    onWarning?.(msg);
    process.stderr.write(`[geodesic] warn: ${msg}\n`);
  }

  // Stage 3 — Artifacts
  onProgress?.('Generating architecture map, skill file, and gap report in parallel…');
  process.stderr.write('[geodesic] synthesis 3/3: generating artifacts…\n');
  const artifacts = await runArtifacts(harvest, crystal, meta, deepResults, discovery.context, provider, systemPrompt, transitionDocs ?? null);
  totalTokens += artifacts.tokensUsed;
  onPhaseEvent?.({ type: 'artifacts_complete' });

  return parseSynthesisResponse(
    { archMap: artifacts.archMap, skillFile: artifacts.skillFile, gapReport: artifacts.gapReport },
    { ...meta, synthesisTokensUsed: totalTokens, echoHintsApplied: discovery.subsystems.length, analysisDurationMs: Date.now() - startedAt },
  );
}

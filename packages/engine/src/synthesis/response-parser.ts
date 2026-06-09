import type { SynthesisResult, SkillFileJson, GapReport } from '@geodesic/types';

function sanitizeFinding(f: unknown): unknown {
  if (typeof f !== 'object' || f === null) return null;
  const obj = f as Record<string, unknown>;
  // Drop findings missing the fields the renderer requires
  if (typeof obj['severity'] !== 'string') return null;
  if (typeof obj['description'] !== 'string') return null;
  if (typeof obj['file'] !== 'string') return null;
  return {
    ...obj,
    detail:    typeof obj['detail']    === 'string' ? obj['detail']    : '',
    fix:       typeof obj['fix']       === 'string' ? obj['fix']       : '',
    lineStart: typeof obj['lineStart'] === 'number' ? obj['lineStart'] : 0,
    lineEnd:   typeof obj['lineEnd']   === 'number' ? obj['lineEnd']   : 0,
    deduction: typeof obj['deduction'] === 'number' ? obj['deduction'] : 0,
  };
}

function sanitizeDimension(d: unknown): unknown {
  if (typeof d !== 'object' || d === null) return null;
  const obj = d as Record<string, unknown>;
  if (typeof obj['dimension'] !== 'string') return null;
  if (typeof obj['grade'] !== 'string') return null;
  const findings = Array.isArray(obj['findings'])
    ? (obj['findings'] as unknown[]).map(sanitizeFinding).filter((f): f is unknown => f !== null)
    : [];
  return {
    ...obj,
    dimension: obj['dimension'],
    score:     typeof obj['score']  === 'number'  ? obj['score']  : 0,
    grade:     obj['grade'],
    active:    typeof obj['active'] === 'boolean' ? obj['active'] : true,
    findings,
  };
}

/**
 * Defensive sanitizer for the AI model's `uncertainDetections` JSON field.
 *
 * NOTE: in normal operation the engine pipeline AND the CLI both overwrite
 * `gapReport.uncertainDetections` with the scrubber's authoritative list right
 * before `writeArtifacts()` (see uncertainDetectionsToReport). This sanitizer
 * is defense-in-depth — it ensures that if the override is ever bypassed (e.g.
 * a future code path forgets to call it), the writer still cannot emit visibly
 * broken rows like `Trigger: (empty)` / `Confidence: 0% (undefined)`.
 *
 * Rules:
 *   - Drop the row entirely if `file` is missing OR `trigger` is empty (no
 *     detection means nothing meaningful to surface to a human reviewer).
 *   - Default every other field to a sentinel value the writer can render
 *     without producing `undefined` literals in the markdown output.
 */
function sanitizeUncertainDetection(u: unknown): unknown {
  if (typeof u !== 'object' || u === null) return null;
  const obj = u as Record<string, unknown>;
  if (typeof obj['file'] !== 'string' || obj['file'].trim() === '') return null;
  const trigger = typeof obj['trigger'] === 'string' ? obj['trigger'].trim() : '';
  if (trigger === '') return null;
  const confidenceRaw = typeof obj['confidence'] === 'string' ? obj['confidence'].toUpperCase() : '';
  const confidence: 'UNCERTAIN' | 'LOW' = confidenceRaw === 'UNCERTAIN' ? 'UNCERTAIN' : 'LOW';
  return {
    ...obj,
    file:               obj['file'],
    lineStart:          typeof obj['lineStart']         === 'number' ? obj['lineStart']         : 0,
    lineEnd:            typeof obj['lineEnd']           === 'number' ? obj['lineEnd']           : 0,
    isApproximateRange: typeof obj['isApproximateRange']=== 'boolean'? obj['isApproximateRange']: true,
    trigger,
    confidence,
    confidencePct:      typeof obj['confidencePct']     === 'number' ? obj['confidencePct']     : 0,
    attestationRef:     typeof obj['attestationRef']    === 'string' ? obj['attestationRef']    : '(model-generated, not in attestation chain)',
    action:             typeof obj['action']            === 'string' ? obj['action']
                       : typeof obj['recommendedAction']=== 'string' ? obj['recommendedAction']
                       : 'Review manually — no recommended action supplied by synthesis.',
    recommendedAction:  typeof obj['recommendedAction'] === 'string' ? obj['recommendedAction'] : '',
    markedReviewed:     typeof obj['markedReviewed']    === 'boolean'? obj['markedReviewed']    : false,
  };
}

function assertGapReport(val: unknown): asserts val is GapReport {
  if (typeof val !== 'object' || val === null)
    throw new Error('GAP_REPORT must be a JSON object');
  const obj = val as Record<string, unknown>;
  if (typeof obj['repoName'] !== 'string')
    throw new Error('GAP_REPORT missing required .repoName string');
  if (typeof obj['overallScore'] !== 'number')
    throw new Error('GAP_REPORT missing required .overallScore number');
  if (!Array.isArray(obj['dimensions']))
    throw new Error('GAP_REPORT missing required .dimensions array');

  if (typeof obj['overallGrade'] !== 'string')
    throw new Error('GAP_REPORT missing required .overallGrade string');

  // Sanitize every dimension and its findings
  obj['dimensions'] = (obj['dimensions'] as unknown[])
    .map(sanitizeDimension)
    .filter((d): d is unknown => d !== null);

  // Sanitize uncertain detections
  if (!Array.isArray(obj['uncertainDetections'])) {
    obj['uncertainDetections'] = [];
  } else {
    obj['uncertainDetections'] = (obj['uncertainDetections'] as unknown[])
      .map(sanitizeUncertainDetection)
      .filter((u): u is unknown => u !== null);
  }
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json|markdown|md|text)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

function parseJson(raw: string, label: string): unknown {
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${label} JSON: ${msg}\nRaw (first 200 chars): ${cleaned.slice(0, 200)}`);
  }
}

export interface SynthesisMeta {
  analystId: string;
  repo: string;
  repoCommit: string;
  crystalId: string | null;
  crystalMatchScore: number | null;
  provider: string;
  model: string;
  synthesisTokensUsed: number;
  echoHintsApplied: number;
  analysisDurationMs: number;
}

export function parseSynthesisResponse(
  parts: { archMap: string; skillFile: SkillFileJson; gapReport: string },
  meta: SynthesisMeta,
): SynthesisResult {
  const archMapRaw   = parts.archMap.trim();
  const gapReportRaw = stripCodeFences(parts.gapReport);

  const rawGapReport = parseJson(gapReportRaw, 'GAP_REPORT');
  assertGapReport(rawGapReport);
  const gapReport: GapReport = rawGapReport;

  // Patch authoritative meta fields into the pre-assembled skill file
  const skillFile: SkillFileJson = {
    ...parts.skillFile,
    meta: {
      ...parts.skillFile.meta,
      analysisDurationMs: meta.analysisDurationMs,
    },
  };

  gapReport.analyzedAt = new Date().toISOString();

  return {
    skillFile,
    gapReport,
    architectureMapMarkdown: archMapRaw,
    synthesisTokensUsed: meta.synthesisTokensUsed,
    echoHintsApplied: meta.echoHintsApplied,
    crystalId: meta.crystalId,
  };
}

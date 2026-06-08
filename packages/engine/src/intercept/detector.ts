import { ALL_PATTERNS, type PatternDef } from './patterns.js';

export interface Detection {
  readonly patternId: string;
  readonly patternDef: PatternDef;
  readonly match: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Scan a single string value for all PII/PHI/secret patterns.
 * Returns detections sorted by startIndex ascending.
 * Overlapping detections are resolved: highest-confidence wins.
 */
export function detectInValue(value: string): Detection[] {
  const raw: Detection[] = [];

  for (const def of ALL_PATTERNS) {
    const regex = new RegExp(def.pattern.source, def.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
      raw.push({
        patternId: def.id,
        patternDef: def,
        match: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  if (raw.length === 0) return [];

  // Sort by startIndex ascending, then by confidencePct descending
  raw.sort((a, b) =>
    a.startIndex !== b.startIndex
      ? a.startIndex - b.startIndex
      : b.patternDef.confidencePct - a.patternDef.confidencePct,
  );

  // Remove overlapping detections — keep the one that starts earliest;
  // when starts are equal, keep highest confidence (already sorted above)
  const resolved: Detection[] = [];
  let lastEnd = -1;

  for (const detection of raw) {
    if (detection.startIndex >= lastEnd) {
      resolved.push(detection);
      lastEnd = detection.endIndex;
    }
    // If start < lastEnd, this detection overlaps with one already accepted —
    // skip it (the earlier/higher-confidence one wins)
  }

  return resolved;
}

/**
 * Check whether a JSON field name (key) is structural — i.e. its value
 * should never be scrubbed because it IS a path, language name, method name, etc.
 */
const STRUCTURAL_FIELDS = new Set([
  'path', 'file', 'name', 'language', 'type', 'method', 'status',
  'keyDirectoryType', 'engine', 'orm', 'migrationsTool', 'trigger',
  'primary', 'monoRepoTool', 'monoRepoTool', 'scrubAction',
  'piiCategory', 'piiType', 'hipaaIdentifier', 'hipaaSafeHarborItem',
  'scrubConfidence', 'tokenPlaced', 'prevHash', 'thisHash',
  'entryId', 'analystId', 'repo', 'repoCommit', 'payloadHash',
]);

export function isStructuralField(fieldName: string): boolean {
  return STRUCTURAL_FIELDS.has(fieldName);
}

import type {
  HarvestResult,
  HipaaIdentifierCategory,
  InterceptResult,
  PiiCategory,
  PiiType,
  ScrubConfidence,
  UncertainDetection,
} from '@geodesic/types';
import { PurityCheckError } from '@geodesic/types';
import { detectInValue, isStructuralField } from './detector.js';
import { generateRefId, buildToken, applyReplacements } from './tokenizer.js';
import { AttestationChain, computeHash } from './attestation.js';
import { verifyPurity } from './purity.js';

export interface ScrubContext {
  readonly analystId: string;
  readonly repo: string;
  readonly repoCommit: string;
}

interface PendingDetection {
  entryId: string;
  token: string;
  jsonPath: string;
  startIndex: number;
  endIndex: number;
  patternId: string;
  match: string;
  category: PiiCategory;
  piiType: PiiType;
  hipaaIdentifier: HipaaIdentifierCategory | null;
  hipaaSafeHarborItem: string | null;
  confidence: ScrubConfidence;
  confidencePct: number;
}

const MAX_SCRUB_DEPTH = 50;

// Scrub a single string value. Returns the (possibly replaced) string. Pushes any attestation
// candidates onto `pending`. Strings are immutable in JS, so even the in-place walker has to
// allocate a new string when replacements happen — but that allocation is bounded by detection
// hits, not by tree shape.
function scrubString(
  value: string,
  fieldName: string,
  jsonPath: string,
  usedRefIds: Set<string>,
  pending: PendingDetection[],
): string {
  if (isStructuralField(fieldName)) return value;
  const detections = detectInValue(value);
  if (detections.length === 0) return value;

  const tokens: string[] = [];
  for (const detection of detections) {
    const refId = generateRefId(usedRefIds);
    const token = buildToken(
      detection.patternDef.category,
      detection.patternDef.piiType,
      refId,
      detection.patternDef.confidence,
    );
    tokens.push(token);
    pending.push({
      entryId: refId,
      token,
      jsonPath,
      startIndex: detection.startIndex,
      endIndex: detection.endIndex,
      patternId: detection.patternId,
      match: detection.match,
      category: detection.patternDef.category,
      piiType: detection.patternDef.piiType,
      hipaaIdentifier: detection.patternDef.hipaaIdentifier,
      hipaaSafeHarborItem: detection.patternDef.hipaaSafeHarborItem,
      confidence: detection.patternDef.confidence,
      confidencePct: detection.patternDef.confidencePct,
    });
  }
  return applyReplacements(value, detections, tokens);
}

// In-place tree walker. Mutates arrays and objects directly — only string values are reassigned
// (since strings are immutable). The original harvest object's structural identity is preserved
// throughout, so we never carry two parallel copies of the tree at peak.
//
// IMPORTANT: the caller must not retain the original harvest reference after this returns;
// the harvest has been mutated in place to contain attestation tokens.
function walkAndScrubInPlace(
  obj: unknown,
  fieldName: string,
  jsonPath: string,
  usedRefIds: Set<string>,
  pending: PendingDetection[],
  depth: number,
  seen: Set<object>,
): unknown {
  if (depth > MAX_SCRUB_DEPTH) return obj;

  if (typeof obj === 'string') {
    return scrubString(obj, fieldName, jsonPath, usedRefIds, pending);
  }

  if (Array.isArray(obj)) {
    if (seen.has(obj)) return obj;
    seen.add(obj);
    for (let i = 0; i < obj.length; i++) {
      obj[i] = walkAndScrubInPlace(
        obj[i],
        fieldName,
        `${jsonPath}[${String(i)}]`,
        usedRefIds,
        pending,
        depth + 1,
        seen,
      );
    }
    seen.delete(obj);
    return obj;
  }

  if (typeof obj === 'object' && obj !== null) {
    if (seen.has(obj)) return obj;
    seen.add(obj);
    const rec = obj as Record<string, unknown>;
    // Snapshot keys before iterating — Object.keys returns a fresh array so concurrent
    // mutation of values is safe, but defensive in case future code adds key churn.
    const keys = Object.keys(rec);
    for (const key of keys) {
      rec[key] = walkAndScrubInPlace(
        rec[key],
        key,
        `${jsonPath}.${key}`,
        usedRefIds,
        pending,
        depth + 1,
        seen,
      );
    }
    seen.delete(obj);
    return obj;
  }

  return obj;
}

/**
 * Main intercept entry point. Mutates the harvest object in place: every flagged string is
 * replaced with its attestation token, and the same object is returned via `scrubbedHarvest`.
 *
 * The caller must NOT retain a reference to the original harvest after this call — there is
 * no separate "before" copy. This is the central memory-saving change for medplum-scale repos.
 *
 * Throws PurityCheckError if any PII survives scrubbing.
 */
export function intercept(
  harvest: HarvestResult,
  ctx: ScrubContext,
): InterceptResult {
  const usedRefIds = new Set<string>();
  const pending: PendingDetection[] = [];

  // In-place walk. After this line, `harvest` itself contains attestation tokens
  // wherever the detector fired. No second copy is allocated for the tree itself.
  walkAndScrubInPlace(harvest, 'root', 'harvest', usedRefIds, pending, 0, new Set<object>());

  // Hash the canonicalized JSON serialization. This string lives only inside this function;
  // it is freed when intercept() returns. Attestation entries reference the hash, not the string.
  const payloadHash = computeHash(JSON.stringify(harvest));

  // Build attestation chain
  const chain = new AttestationChain();
  const uncertainDetections: UncertainDetection[] = [];

  for (const p of pending) {
    const entry = chain.addEntry({
      entryId: p.entryId,
      analystId: ctx.analystId,
      repo: ctx.repo,
      repoCommit: ctx.repoCommit,
      // File recorded as the JSON path within the harvest payload
      file: `[payload:${p.jsonPath}]`,
      lineStart: 1,
      lineEnd: 1,
      colStart: p.startIndex,
      colEnd: p.endIndex,
      piiCategory: p.category,
      piiType: p.piiType,
      hipaaIdentifier: p.hipaaIdentifier,
      hipaaSafeHarborItem: p.hipaaSafeHarborItem,
      scrubConfidence: p.confidence,
      tokenPlaced: p.token,
      payloadHash,
    });

    if (entry.scrubConfidence === 'UNCERTAIN' || entry.scrubConfidence === 'LOW') {
      uncertainDetections.push({
        entryId: entry.entryId,
        file: entry.file,
        lineStart: entry.lineStart,
        lineEnd: entry.lineEnd,
        isApproximateRange: true,
        trigger: `Pattern: ${p.patternId} matched "${p.match.slice(0, 40)}"`,
        confidence: entry.scrubConfidence,
        confidencePct: p.confidencePct,
        attestationRef: entry.entryId,
        recommendedAction:
          `Open the source repository at payload path '${p.jsonPath}'. ` +
          `Confirm or clear the detection manually via: geodesic review mark-reviewed --ref ${entry.entryId}`,
        markedReviewed: false,
        reviewedAt: null,
        reviewedBy: null,
      });
    }
  }

  // Mandatory purity check — walks the (already scrubbed) object directly, so no JSON
  // string is built for this step. Catches anything the detector missed before AI sees it.
  const purity = verifyPurity(harvest);
  if (!purity.clean) {
    throw new PurityCheckError(
      purity.firstMatchPattern ?? 'unknown',
      purity.firstMatchPosition ?? 0,
      purity.firstMatchPath ?? undefined,
      purity.firstMatchValue ?? undefined,
    );
  }

  const attestationEntries = chain.getEntries();
  const phiCount = attestationEntries.filter(e => e.piiCategory === 'PHI').length;
  const secretCount = attestationEntries.filter(e => e.piiCategory === 'SECRET').length;
  const piiCount = attestationEntries.filter(e => e.piiCategory === 'PII').length;

  return {
    scrubbedHarvest: harvest,
    payloadHash,
    attestationEntries,
    uncertainDetections,
    piiCount,
    phiCount,
    secretCount,
    purityVerified: true,
  };
}

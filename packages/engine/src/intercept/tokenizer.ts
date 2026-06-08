import type { PiiCategory, PiiType, ScrubConfidence } from '@geodesic/types';

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a 4-character alphanumeric reference ID, unique within a session.
 * The uniqueness guarantee is enforced by the caller tracking used IDs.
 */
export function generateRefId(usedIds: Set<string>): string {
  let id: string;
  do {
    id = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

/**
 * Build a token string in the exact format specified by the PII/HIPAA spec:
 *   [{CATEGORY}:{PII_TYPE}:ref:{REF_ID}:CONF:{CONFIDENCE}]
 *   [{CATEGORY}:{PII_TYPE}:ref:{REF_ID}:CONF:{CONFIDENCE}:REVIEW_REQUIRED]
 */
export function buildToken(
  category: PiiCategory,
  piiType: PiiType,
  refId: string,
  confidence: ScrubConfidence,
): string {
  const needsReview = confidence === 'UNCERTAIN' || confidence === 'LOW';
  const base = `[${category}:${piiType}:ref:${refId}:CONF:${confidence}`;
  return needsReview ? `${base}:REVIEW_REQUIRED]` : `${base}]`;
}

/**
 * Apply multiple detections to a string value, replacing right-to-left
 * to preserve start positions. Returns the scrubbed string and the
 * list of (refId, token) pairs in the same order as detections.
 */
export function applyReplacements(
  value: string,
  detections: Array<{ startIndex: number; endIndex: number }>,
  tokens: string[],
): string {
  // Pair detections with tokens and sort right-to-left
  const pairs = detections.map((d, i) => ({ ...d, token: tokens[i] ?? '' }));
  pairs.sort((a, b) => b.startIndex - a.startIndex);

  let result = value;
  for (const { startIndex, endIndex, token } of pairs) {
    result = result.slice(0, startIndex) + token + result.slice(endIndex);
  }
  return result;
}

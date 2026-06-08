import { PURITY_PATTERNS } from './patterns.js';
import { isStructuralField } from './detector.js';

export interface PurityResult {
  readonly clean: boolean;
  readonly firstMatchPattern: string | null;
  readonly firstMatchPosition: number | null;
  readonly firstMatchValue: string | null;
  readonly firstMatchPath: string | null;
}

const CLEAN: PurityResult = {
  clean: true,
  firstMatchPattern: null,
  firstMatchPosition: null,
  firstMatchValue: null,
  firstMatchPath: null,
};

/**
 * Verify that a scrubbed harvest object contains no PII/PHI/secret values.
 *
 * Walks the parsed object tree — NOT the raw JSON string — so JSON escape
 * sequences (e.g. \n before a Python @decorator) never produce false positives.
 *
 * Only HIGH/MEDIUM-confidence patterns are checked; UNCERTAIN/LOW are scrubbed
 * during the walk phase but excluded here to avoid false-positive pipeline halts.
 *
 * Structural fields (file paths, language names, etc.) are skipped, consistent
 * with the scrubber's skip policy.
 */
export function verifyPurity(
  obj: unknown,
  fieldName = 'root',
  seen = new Set<object>(),
): PurityResult {
  if (typeof obj === 'string') {
    if (isStructuralField(fieldName)) return CLEAN;
    for (const def of PURITY_PATTERNS) {
      const regex = new RegExp(def.pattern.source, def.pattern.flags);
      const match = regex.exec(obj);
      if (match !== null) {
        return {
          clean: false,
          firstMatchPattern: def.description,
          firstMatchPosition: match.index,
          firstMatchValue: match[0].slice(0, 60) + (match[0].length > 60 ? '…' : ''),
          firstMatchPath: fieldName,
        };
      }
    }
    return CLEAN;
  }

  if (Array.isArray(obj)) {
    if (seen.has(obj)) return CLEAN;
    seen.add(obj);
    for (const item of obj) {
      const r = verifyPurity(item, fieldName, seen);
      if (!r.clean) { seen.delete(obj); return r; }
    }
    seen.delete(obj);
    return CLEAN;
  }

  if (typeof obj === 'object' && obj !== null) {
    if (seen.has(obj)) return CLEAN;
    seen.add(obj);
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const r = verifyPurity(value, key, seen);
      if (!r.clean) { seen.delete(obj); return r; }
    }
    seen.delete(obj);
    return CLEAN;
  }

  return CLEAN;
}

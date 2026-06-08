/**
 * Loads and validates a Baseline JSON file.
 *
 * The baseline is a curated, typed subset of harvest reality used as the
 * gold-standard reference for drift detection. It's normally produced by
 * hand (or with light tooling) from architecture docs and committed
 * alongside the audit so runs are reproducible.
 */

import * as fs from 'fs';
import type { Baseline } from '@geodesic/types';

const SUPPORTED_SCHEMA_VERSION = '1.0.0';

export class BaselineLoadError extends Error {
  override readonly name = 'BaselineLoadError';
}

/** Read + parse + validate a baseline file. Throws BaselineLoadError on any problem. */
export function loadBaselineFile(filePath: string): Baseline {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new BaselineLoadError(
      `Cannot read baseline ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BaselineLoadError(
      `Baseline ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateBaseline(parsed, filePath);
}

/** Type-narrowing validator. Cheap and strict — no zod dep. */
export function validateBaseline(value: unknown, sourcePath?: string): Baseline {
  const where = sourcePath ? ` (${sourcePath})` : '';
  if (!value || typeof value !== 'object') {
    throw new BaselineLoadError(`Baseline${where} must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;

  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new BaselineLoadError(
      `Baseline${where} schemaVersion = ${String(obj.schemaVersion)} — this build supports "${SUPPORTED_SCHEMA_VERSION}".`,
    );
  }
  requireString(obj, 'name', where);
  requireString(obj, 'generatedAt', where);
  requireArray(obj, 'sourceDocs', where);
  requireArray(obj, 'components', where);
  requireArray(obj, 'databases', where);
  requireArray(obj, 'containers', where);
  requireArray(obj, 'storage', where);
  requireArray(obj, 'apiRoutes', where);
  requireArray(obj, 'edges', where);

  return obj as unknown as Baseline;
}

function requireString(obj: Record<string, unknown>, key: string, where: string): void {
  if (typeof obj[key] !== 'string') {
    throw new BaselineLoadError(`Baseline${where}: "${key}" must be a string`);
  }
}
function requireArray(obj: Record<string, unknown>, key: string, where: string): void {
  if (!Array.isArray(obj[key])) {
    throw new BaselineLoadError(`Baseline${where}: "${key}" must be an array`);
  }
}

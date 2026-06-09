/**
 * Generic SHA-256 chained JSONL writer.
 *
 * Used by:
 *   - PII / HIPAA attestation (existing, via `interceptResult.attestationEntries`)
 *   - Datasource attestation
 *
 * Design rules:
 *   - Canonical JSON: sorted keys, no whitespace, UTF-8. This is what gets hashed.
 *   - `hash = sha256(prevHash || canonicalJSON(record minus hash field))`
 *   - Zero-hash (`'0'.repeat(64)`) seeds the chain for seq=1.
 *   - Pure: hashing is in-memory; only `writeChainFile` touches disk.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ChainVerifyResult } from '@geodesic/types';

export const ZERO_HASH = '0'.repeat(64);

/** Canonical JSON: stable key order, no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

/** Hex SHA-256. */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute the hash for a record given the prior hash. The input record must
 * NOT yet contain a `hash` field (it will be ignored if it does).
 */
export function computeRecordHash(prevHash: string, recordWithoutHash: Record<string, unknown>): string {
  const { hash: _ignored, ...rest } = recordWithoutHash;
  void _ignored;
  return sha256Hex(prevHash + canonicalize(rest));
}

/**
 * Append-only in-memory chain builder. Call `append()` for each record;
 * the returned record carries its `seq`, `prevHash`, and `hash`.
 */
export class ChainBuilder<T extends Record<string, unknown>> {
  private prev: string = ZERO_HASH;
  private seq = 0;
  public readonly records: Array<T & { seq: number; prevHash: string; hash: string }> = [];

  append(record: T): T & { seq: number; prevHash: string; hash: string } {
    this.seq += 1;
    const withChain = { ...record, seq: this.seq, prevHash: this.prev };
    const hash = computeRecordHash(this.prev, withChain);
    const sealed = { ...withChain, hash } as T & { seq: number; prevHash: string; hash: string };
    this.records.push(sealed);
    this.prev = hash;
    return sealed;
  }

  /** Hash of the last record — pins the whole chain in one value. */
  tipHash(): string | null {
    return this.records.length === 0 ? null : (this.records[this.records.length - 1]?.hash ?? null);
  }
}

/** Write the chain to disk as JSONL. Creates parent directories. */
export function writeChainFile(filePath: string, records: ReadonlyArray<Record<string, unknown>>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = records.map(r => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  fs.writeFileSync(filePath, body, 'utf8');
}

/**
 * Re-walk a JSONL chain file and confirm every link. Reads the file lazily
 * line-by-line via the buffered `fs.readFileSync` (chains are small enough).
 */
export function verifyChainFile(filePath: string): ChainVerifyResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      ok: false, recordsChecked: 0, firstBrokenSeq: null,
      reason: `cannot read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const lines = raw.split('\n').filter(l => l.length > 0);
  let prev = ZERO_HASH;
  let expectedSeq = 1;

  for (let i = 0; i < lines.length; i++) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i] ?? '') as Record<string, unknown>;
    } catch {
      return { ok: false, recordsChecked: i, firstBrokenSeq: expectedSeq, reason: `line ${String(i + 1)}: not JSON` };
    }
    if (parsed.seq !== expectedSeq) {
      return { ok: false, recordsChecked: i, firstBrokenSeq: expectedSeq,
        reason: `line ${String(i + 1)}: expected seq=${String(expectedSeq)}, got ${String(parsed.seq)}` };
    }
    if (parsed.prevHash !== prev) {
      return { ok: false, recordsChecked: i, firstBrokenSeq: expectedSeq,
        reason: `line ${String(i + 1)}: prevHash mismatch` };
    }
    const declared = parsed.hash;
    if (typeof declared !== 'string') {
      return { ok: false, recordsChecked: i, firstBrokenSeq: expectedSeq, reason: `line ${String(i + 1)}: missing hash` };
    }
    const recomputed = computeRecordHash(prev, parsed);
    if (recomputed !== declared) {
      return { ok: false, recordsChecked: i, firstBrokenSeq: expectedSeq,
        reason: `line ${String(i + 1)}: hash mismatch (tampered or corrupted)` };
    }
    prev = declared;
    expectedSeq += 1;
  }

  return { ok: true, recordsChecked: lines.length, firstBrokenSeq: null, reason: null };
}

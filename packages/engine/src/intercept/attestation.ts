import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AttestationEntry, PiiCategory, PiiType, ScrubConfidence } from '@geodesic/types';
import type { HipaaIdentifierCategory } from '@geodesic/types';
import { AttestationError } from '@geodesic/types';

const GENESIS_HASH = '0'.repeat(64);

export function computeHash(data: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export interface NewEntryParams {
  entryId: string;
  analystId: string;
  repo: string;
  repoCommit: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  colStart: number | null;
  colEnd: number | null;
  piiCategory: PiiCategory;
  piiType: PiiType;
  hipaaIdentifier: HipaaIdentifierCategory | null;
  hipaaSafeHarborItem: string | null;
  scrubConfidence: ScrubConfidence;
  tokenPlaced: string;
  payloadHash: string;
}

export class AttestationChain {
  private readonly entries: AttestationEntry[] = [];
  private prevHash = GENESIS_HASH;
  private seq = 0;

  addEntry(params: NewEntryParams): AttestationEntry {
    this.seq += 1;

    // Build entry without thisHash so we can compute it
    const entryWithoutHash: Omit<AttestationEntry, 'thisHash'> = {
      entryId: params.entryId,
      chainSeq: this.seq,
      prevHash: this.prevHash,
      detectedAt: new Date().toISOString(),
      analystId: params.analystId,
      repo: params.repo,
      repoCommit: params.repoCommit,
      file: params.file,
      lineStart: params.lineStart,
      lineEnd: params.lineEnd,
      colStart: params.colStart,
      colEnd: params.colEnd,
      piiCategory: params.piiCategory,
      piiType: params.piiType,
      hipaaIdentifier: params.hipaaIdentifier,
      hipaaSafeHarborItem: params.hipaaSafeHarborItem,
      scrubConfidence: params.scrubConfidence,
      scrubAction: 'REPLACED_WITH_TOKEN',
      tokenPlaced: params.tokenPlaced,
      payloadHash: params.payloadHash,
    };

    // thisHash = sha256(entry without thisHash)
    const thisHash = computeHash(JSON.stringify(entryWithoutHash));

    const entry: AttestationEntry = { ...entryWithoutHash, thisHash };
    this.entries.push(entry);

    // Next entry's prevHash = sha256(full current entry JSON)
    this.prevHash = computeHash(JSON.stringify(entry));

    return entry;
  }

  getEntries(): AttestationEntry[] {
    return [...this.entries];
  }

  /**
   * Write the chain to a JSONL file (append-only). Each line is one JSON object.
   * Throws AttestationError if the write fails.
   */
  writeToFile(outputPath: string): void {
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const lines = this.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(outputPath, lines, 'utf-8');
    } catch (err) {
      throw new AttestationError(
        `Failed to write attestation chain to ${outputPath}: ${String(err)}`,
      );
    }
  }

  /**
   * Verify chain integrity: recompute each thisHash and each prevHash link.
   * Returns true if the chain is intact, false with details if tampered.
   */
  static verify(entries: AttestationEntry[]): { valid: boolean; error: string | null } {
    let prevHash = GENESIS_HASH;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;

      if (entry.chainSeq !== i + 1) {
        return { valid: false, error: `Entry ${String(i + 1)}: chainSeq ${String(entry.chainSeq)} is out of order` };
      }

      if (entry.prevHash !== prevHash) {
        return { valid: false, error: `Entry ${String(entry.chainSeq)}: prevHash mismatch` };
      }

      // Recompute thisHash from entry without thisHash
      const { thisHash, ...entryWithoutHash } = entry;
      const recomputed = computeHash(JSON.stringify(entryWithoutHash));
      if (thisHash !== recomputed) {
        return { valid: false, error: `Entry ${String(entry.chainSeq)}: thisHash tampered` };
      }

      prevHash = computeHash(JSON.stringify(entry));
    }

    return { valid: true, error: null };
  }
}

/**
 * Parse a JSONL attestation file back into an array of entries.
 */
export function readAttestationFile(filePath: string): AttestationEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as AttestationEntry);
}

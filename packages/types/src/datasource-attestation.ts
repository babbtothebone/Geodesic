/**
 * Immutable Data Source Attestation.
 *
 * One record per discovered data source (database connection, API endpoint,
 * external sink). Records are appended to a SHA-256-chained JSONL file so the
 * audit can be replayed and verified offline.
 *
 * IMPORTANT: only harvested *facts* enter this chain. LLM output never does.
 * The chain is meant to answer "what did the codebase actually contain at
 * time T", which only has meaning if it's deterministic.
 */

export type DatasourceKind = 'db' | 'api' | 'sink' | 'env-connection';

export interface DatasourceAttestationEntity {
  /** Free-form normalized payload; shape depends on `kind`. */
  [key: string]: unknown;
}

export interface DatasourceAttestationSource {
  /** Repo-relative file path that surfaced the source, when known. */
  file: string | null;
  /** 1-based line number, when known. */
  line: number | null;
  /** Name of the harvester subsystem that produced the record. */
  harvester: string;
}

export interface DatasourceAttestationRecord {
  /** 1-based monotonic sequence within the file. */
  seq: number;
  /** ISO-8601 UTC timestamp. */
  ts: string;
  /** Repo name + commit at audit time. */
  repo: string;
  repoCommit: string;
  /** Audit run id (shared by all records in one run). */
  runId: string;
  kind: DatasourceKind;
  source: DatasourceAttestationSource;
  entity: DatasourceAttestationEntity;
  /** Hex SHA-256 of the previous record's `hash`, or zero-hash for seq=1. */
  prevHash: string;
  /** Hex SHA-256 of canonical(this record minus `hash`). */
  hash: string;
}

export interface DatasourceAttestationSummary {
  recordCount: number;
  dbCount: number;
  apiCount: number;
  sinkCount: number;
  envConnectionCount: number;
  filePath: string;
  /** Hash of the final record — anchors the whole chain in one value. */
  tipHash: string | null;
}

export interface ChainVerifyResult {
  ok: boolean;
  recordsChecked: number;
  /** 1-based seq of the first broken record, if any. */
  firstBrokenSeq: number | null;
  reason: string | null;
}

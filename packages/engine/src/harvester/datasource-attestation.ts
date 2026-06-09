/**
 * Builds a SHA-256-chained JSONL attestation for every
 * data source discovered during harvest: DB engines, schema files,
 * env-var connection strings, and API endpoints.
 *
 * Pure derivation from HarvestResult — no LLM, no I/O until `writeChainFile`.
 */

import type {
  HarvestResult,
  DatasourceAttestationRecord,
  DatasourceAttestationSummary,
} from '@geodesic/types';
import { ChainBuilder, writeChainFile } from '../intercept/chain-writer.js';

export interface BuildDatasourceAttestationOpts {
  repo: string;
  repoCommit: string;
  runId: string;
  /** Timestamp factory — injectable for deterministic tests. */
  now?: () => string;
}

export function buildDatasourceAttestation(
  harvest: HarvestResult,
  opts: BuildDatasourceAttestationOpts,
): DatasourceAttestationRecord[] {
  const now = opts.now ?? (() => new Date().toISOString());
  const chain = new ChainBuilder<Omit<DatasourceAttestationRecord, 'seq' | 'prevHash' | 'hash'>>();

  const base = {
    repo: opts.repo,
    repoCommit: opts.repoCommit,
    runId: opts.runId,
  };

  // ── DB engines ──────────────────────────────────────────────────────────
  for (const engine of [...harvest.databases.engines].sort()) {
    chain.append({
      ...base,
      ts: now(),
      kind: 'db',
      source: { file: null, line: null, harvester: 'database-detector' },
      entity: {
        engine,
        orm: harvest.databases.orm,
        migrationsTool: harvest.databases.migrationsTool,
        migrationCount: harvest.databases.migrationCount,
      },
    });
  }

  // ── Schema files (DB definitions in code) ───────────────────────────────
  for (const schemaFile of [...harvest.databases.schemaFiles].sort()) {
    chain.append({
      ...base,
      ts: now(),
      kind: 'db',
      source: { file: schemaFile, line: null, harvester: 'database-detector' },
      entity: { schemaFile, engines: harvest.databases.engines },
    });
  }

  // ── Env-var connection strings ──────────────────────────────────────────
  // These are the *names* of vars, not their values — never put secrets in
  // the chain. The harvester has already classified `isSecret`.
  for (const name of [...harvest.databases.connectionEnvVars].sort()) {
    const detail = harvest.envVars.find(v => v.name === name);
    chain.append({
      ...base,
      ts: now(),
      kind: 'env-connection',
      source: { file: detail?.file ?? null, line: null, harvester: 'env-var-collector' },
      entity: {
        name,
        purpose: detail?.inferredPurpose ?? null,
        isSecret: detail?.isSecret ?? true,
        hasValue: detail?.hasValue ?? false,
      },
    });
  }

  // ── API endpoints (sorted for determinism) ──────────────────────────────
  const sortedRoutes = [...harvest.apiRoutes].sort((a, b) =>
    (a.file + a.method + a.path).localeCompare(b.file + b.method + b.path),
  );
  for (const route of sortedRoutes) {
    chain.append({
      ...base,
      ts: now(),
      kind: 'api',
      source: { file: route.file, line: route.line, harvester: 'api-route-extractor' },
      entity: {
        method: route.method,
        path: route.path,
        authRequired: route.authRequired,
        authMethod: route.authMethod,
        middlewareChain: route.middlewareChain,
      },
    });
  }

  // ── Sinks: Docker-exposed ports (rough proxy for external surface) ──────
  if (harvest.cicd.docker.hasDockerfile || harvest.cicd.docker.hasCompose) {
    for (const port of [...harvest.cicd.docker.exposedPorts].sort((a, b) => a - b)) {
      chain.append({
        ...base,
        ts: now(),
        kind: 'sink',
        source: { file: null, line: null, harvester: 'cicd-detector' },
        entity: { kind: 'exposed-port', port },
      });
    }
  }

  return chain.records;
}

export function writeDatasourceAttestation(
  filePath: string,
  records: DatasourceAttestationRecord[],
): DatasourceAttestationSummary {
  writeChainFile(filePath, records as unknown as readonly Record<string, unknown>[]);
  return {
    recordCount: records.length,
    dbCount:           records.filter(r => r.kind === 'db').length,
    apiCount:          records.filter(r => r.kind === 'api').length,
    sinkCount:         records.filter(r => r.kind === 'sink').length,
    envConnectionCount:records.filter(r => r.kind === 'env-connection').length,
    filePath,
    tipHash: records.length === 0 ? null : (records[records.length - 1]?.hash ?? null),
  };
}

import { describe, it, expect } from 'vitest';
import {
  buildDatasourceAttestation,
} from '../datasource-attestation.js';
import { makeHarvest } from './fixtures.js';

const FIXED_TS = '2025-01-01T00:00:00.000Z';
const opts = { repo: 'fixture', repoCommit: 'abc123', runId: 'job-1', now: () => FIXED_TS };

describe('buildDatasourceAttestation', () => {
  it('returns an empty chain when harvest has no datasources', () => {
    const records = buildDatasourceAttestation(makeHarvest(), opts);
    expect(records).toEqual([]);
  });

  it('emits one record per DB engine, sorted', () => {
    const records = buildDatasourceAttestation(
      makeHarvest({ engines: ['redis', 'postgres'] }), opts,
    );
    expect(records.map(r => r.kind)).toEqual(['db', 'db']);
    expect(records.map(r => (r.entity as { engine: string }).engine)).toEqual(['postgres', 'redis']);
  });

  it('emits records for schema files, env-connection vars, and API routes', () => {
    const records = buildDatasourceAttestation(
      makeHarvest({
        engines: ['postgres'],
        schemaFiles: ['prisma/schema.prisma'],
        connectionEnvVars: ['DATABASE_URL'],
        envVars: [{
          name: 'DATABASE_URL', file: '.env', hasValue: false, isTemplate: true,
          inferredPurpose: 'db', isSecret: true,
        }],
        apiRoutes: [{
          method: 'GET', path: '/api/users', file: 'src/routes/users.ts',
          line: 12, authRequired: true, authMethod: 'jwt', middlewareChain: [],
        }],
      }),
      opts,
    );

    const kinds = records.map(r => r.kind);
    expect(kinds).toEqual(['db', 'db', 'env-connection', 'api']);
  });

  it('emits sink records for Docker exposed ports', () => {
    const records = buildDatasourceAttestation(
      makeHarvest({ hasDockerfile: true, exposedPorts: [3000, 8080] }),
      opts,
    );
    expect(records.map(r => r.kind)).toEqual(['sink', 'sink']);
    expect(records.map(r => (r.entity as { port: number }).port)).toEqual([3000, 8080]);
  });

  it('skips sinks when no Dockerfile or compose is present', () => {
    const records = buildDatasourceAttestation(
      makeHarvest({ hasDockerfile: false, exposedPorts: [3000] }),
      opts,
    );
    expect(records).toEqual([]);
  });

  it('produces a valid SHA-256 chain (seq, prevHash, hash)', () => {
    const records = buildDatasourceAttestation(
      makeHarvest({ engines: ['a', 'b', 'c'] }), opts,
    );
    expect(records.map(r => r.seq)).toEqual([1, 2, 3]);
    expect(records[0]!.prevHash).toBe('0'.repeat(64));
    expect(records[1]!.prevHash).toBe(records[0]!.hash);
    expect(records[2]!.prevHash).toBe(records[1]!.hash);
    for (const r of records) expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across runs with same input', () => {
    const a = buildDatasourceAttestation(
      makeHarvest({ engines: ['postgres'] }), opts,
    );
    const b = buildDatasourceAttestation(
      makeHarvest({ engines: ['postgres'] }), opts,
    );
    expect(a.map(r => r.hash)).toEqual(b.map(r => r.hash));
  });

  it('carries repo, repoCommit, runId on every record', () => {
    const records = buildDatasourceAttestation(
      makeHarvest({ engines: ['postgres'] }), opts,
    );
    expect(records[0]!.repo).toBe('fixture');
    expect(records[0]!.repoCommit).toBe('abc123');
    expect(records[0]!.runId).toBe('job-1');
  });
});

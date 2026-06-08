import { describe, it, expect } from 'vitest';
import { detectDrift } from '../drift-detector.js';
import { validateBaseline, BaselineLoadError } from '../loader.js';
import { makeHarvest } from '../../harvester/__tests__/fixtures.js';
import type { Baseline } from '@geodesic/types';

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    schemaVersion: '1.0.0',
    name: 'fixture-baseline',
    generatedAt: '2025-01-01T00:00:00.000Z',
    sourceDocs: [],
    components: [],
    databases: [],
    containers: [],
    storage: [],
    apiRoutes: [],
    edges: [],
    ...overrides,
  };
}

describe('validateBaseline', () => {
  it('accepts a minimal valid baseline', () => {
    expect(() => validateBaseline(makeBaseline())).not.toThrow();
  });

  it('rejects unsupported schemaVersion', () => {
    expect(() => validateBaseline({ ...makeBaseline(), schemaVersion: '9.9.9' }))
      .toThrow(BaselineLoadError);
  });

  it('rejects missing required fields', () => {
    const bad = { ...makeBaseline() } as unknown as Record<string, unknown>;
    delete bad.components;
    expect(() => validateBaseline(bad)).toThrow(BaselineLoadError);
  });

  it('rejects non-object input', () => {
    expect(() => validateBaseline('not an object')).toThrow(BaselineLoadError);
  });
});

describe('detectDrift', () => {
  const fixedNow = { now: () => '2025-01-01T00:00:00.000Z' };

  it('returns zero findings when baseline and harvest are empty', () => {
    const report = detectDrift(makeBaseline(), makeHarvest(), fixedNow);
    expect(report.counts.total).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it('flags P0 when baseline declares a DB engine not in code', () => {
    const baseline = makeBaseline({
      databases: [{ id: 'main-db', engine: 'postgres' }],
    });
    const report = detectDrift(baseline, makeHarvest(), fixedNow);
    expect(report.counts.p0).toBe(1);
    expect(report.findings[0]!.driftKind).toBe('missing-in-code');
    expect(report.findings[0]!.entityKind).toBe('database');
  });

  it('flags P1 when code has a DB engine not in baseline', () => {
    const report = detectDrift(
      makeBaseline(),
      makeHarvest({ engines: ['postgres'] }),
      fixedNow,
    );
    expect(report.counts.p1).toBe(1);
    expect(report.findings[0]!.driftKind).toBe('missing-in-baseline');
  });

  it('finds NO drift when baseline and harvest DB engines align', () => {
    const baseline = makeBaseline({
      databases: [{ id: 'main-db', engine: 'postgres' }],
    });
    const report = detectDrift(
      baseline,
      makeHarvest({ engines: ['postgres'] }),
      fixedNow,
    );
    expect(report.counts.total).toBe(0);
  });

  it('flags P0 when baseline declares an API route not in code', () => {
    const baseline = makeBaseline({
      apiRoutes: [{ method: 'GET', path: '/api/users' }],
    });
    const report = detectDrift(baseline, makeHarvest(), fixedNow);
    expect(report.counts.p0).toBe(1);
    expect(report.findings[0]!.entityId).toBe('route:GET /api/users');
  });

  it('flags P1 when code exposes a route not in baseline', () => {
    const report = detectDrift(
      makeBaseline(),
      makeHarvest({
        apiRoutes: [{
          method: 'POST', path: '/api/secret', file: 'src/secret.ts',
          line: 5, authRequired: false, authMethod: null, middlewareChain: [],
        }],
      }),
      fixedNow,
    );
    expect(report.counts.p1).toBe(1);
    expect(report.findings[0]!.harvestedRef).toMatch(/src\/secret\.ts:5/);
  });

  it('flags P1 mismatch when baseline expects an exposed port that is missing', () => {
    const baseline = makeBaseline({
      containers: [{ id: 'web', ports: [80] }],
    });
    const report = detectDrift(
      baseline,
      makeHarvest({ hasDockerfile: true, exposedPorts: [3000] }),
      fixedNow,
    );
    // expect: 1 missing port (P1) + 1 extra port (P2)
    expect(report.counts.p1).toBe(1);
    expect(report.counts.p2).toBe(1);
  });

  it('flags missing component when none of its owned paths exist', () => {
    const baseline = makeBaseline({
      components: [{ id: 'billing', kind: 'service', owns: ['src/billing/'] }],
    });
    const report = detectDrift(baseline, makeHarvest(), fixedNow);
    const billing = report.findings.find(f => f.entityId === 'component:billing');
    expect(billing).toBeDefined();
    expect(billing!.severity).toBe('P1');
  });

  it('does NOT flag a component when at least one owned path is present', () => {
    const baseline = makeBaseline({
      components: [{ id: 'billing', kind: 'service', owns: ['src/billing/'] }],
    });
    const report = detectDrift(
      baseline,
      makeHarvest({ filePaths: ['src/billing/index.ts'] }),
      fixedNow,
    );
    const billing = report.findings.find(f => f.entityId === 'component:billing');
    expect(billing).toBeUndefined();
  });

  it('sorts findings P0 first, then P1, then P2', () => {
    const baseline = makeBaseline({
      databases: [{ id: 'main-db', engine: 'postgres' }],          // P0
      containers: [{ id: 'web', ports: [80] }],                    // P1
      storage: [{ id: 'bucket-x', kind: 's3' }],                   // P2
    });
    const report = detectDrift(
      baseline,
      makeHarvest({ hasDockerfile: true, exposedPorts: [9999] }),
      fixedNow,
    );
    const severities = report.findings.map(f => f.severity);
    const sorted = [...severities].sort();
    expect(severities).toEqual(sorted);
  });
});

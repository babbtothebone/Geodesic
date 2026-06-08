/**
 * Drift detector — pure structural diff between a Baseline (gold standard)
 * and a HarvestResult (current code reality). No LLM. Deterministic.
 *
 * Severity rules:
 *   - Missing database in code        → P0
 *   - Missing public API route in code → P0
 *   - Mismatched container/port/image → P1
 *   - Extra undocumented component    → P1
 *   - Extra undocumented route        → P1
 *   - Missing edge / storage          → P1
 *   - Everything else                 → P2
 */

import type {
  Baseline,
  DriftFinding,
  DriftReport,
  HarvestResult,
} from '@geodesic/types';

export interface DriftDetectOpts {
  now?: () => string;
}

export function detectDrift(
  baseline: Baseline,
  harvest: HarvestResult,
  opts: DriftDetectOpts = {},
): DriftReport {
  const findings: DriftFinding[] = [];

  findings.push(...diffDatabases(baseline, harvest));
  findings.push(...diffRoutes(baseline, harvest));
  findings.push(...diffContainers(baseline, harvest));
  findings.push(...diffComponents(baseline, harvest));
  // storage + edges: baseline-side only for now (harvest has no storage inventory yet)
  findings.push(...baselineOnlyStorage(baseline, harvest));

  // Deterministic order
  findings.sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) ||
    a.entityKind.localeCompare(b.entityKind) ||
    a.entityId.localeCompare(b.entityId),
  );

  const counts = {
    p0: findings.filter(f => f.severity === 'P0').length,
    p1: findings.filter(f => f.severity === 'P1').length,
    p2: findings.filter(f => f.severity === 'P2').length,
    total: findings.length,
  };

  return {
    baselineName: baseline.name,
    baselineGeneratedAt: baseline.generatedAt,
    comparedAt: (opts.now ?? (() => new Date().toISOString()))(),
    findings,
    counts,
  };
}

// ── Databases ───────────────────────────────────────────────────────────────

function diffDatabases(b: Baseline, h: HarvestResult): DriftFinding[] {
  const out: DriftFinding[] = [];
  const harvestedEngines = new Set(h.databases.engines.map(e => e.toLowerCase()));
  const baselineEngines = new Set(b.databases.map(d => d.engine.toLowerCase()));

  for (const db of b.databases) {
    if (!harvestedEngines.has(db.engine.toLowerCase())) {
      out.push({
        entityKind: 'database',
        driftKind: 'missing-in-code',
        entityId: `db:${db.engine}`,
        baselineRef: db.id,
        harvestedRef: null,
        detail: `Baseline declares database engine "${db.engine}" but harvest found no matching engine.`,
        severity: 'P0',
      });
    }
  }
  for (const engine of h.databases.engines) {
    if (!baselineEngines.has(engine.toLowerCase())) {
      out.push({
        entityKind: 'database',
        driftKind: 'missing-in-baseline',
        entityId: `db:${engine}`,
        baselineRef: null,
        harvestedRef: `databases.engines[${engine}]`,
        detail: `Harvest discovered database engine "${engine}" not present in the baseline.`,
        severity: 'P1',
      });
    }
  }
  return out;
}

// ── API routes ──────────────────────────────────────────────────────────────

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function diffRoutes(b: Baseline, h: HarvestResult): DriftFinding[] {
  const out: DriftFinding[] = [];
  const baselineRoutes = new Map<string, typeof b.apiRoutes[number]>();
  for (const r of b.apiRoutes) baselineRoutes.set(routeKey(r.method, r.path), r);

  const harvestedRoutes = new Map<string, typeof h.apiRoutes[number]>();
  for (const r of h.apiRoutes) harvestedRoutes.set(routeKey(r.method, r.path), r);

  for (const [key, br] of baselineRoutes) {
    if (!harvestedRoutes.has(key)) {
      out.push({
        entityKind: 'route',
        driftKind: 'missing-in-code',
        entityId: `route:${key}`,
        baselineRef: routeKey(br.method, br.path),
        harvestedRef: null,
        detail: `Baseline declares route ${key} but harvest didn't find it in the code.`,
        severity: 'P0',
      });
    }
  }
  for (const [key, hr] of harvestedRoutes) {
    if (!baselineRoutes.has(key)) {
      out.push({
        entityKind: 'route',
        driftKind: 'missing-in-baseline',
        entityId: `route:${key}`,
        baselineRef: null,
        harvestedRef: `${hr.file}:${String(hr.line)}`,
        detail: `Code exposes route ${key} (${hr.file}:${String(hr.line)}) not declared in the baseline.`,
        severity: 'P1',
      });
    }
  }
  return out;
}

// ── Containers ──────────────────────────────────────────────────────────────

function diffContainers(b: Baseline, h: HarvestResult): DriftFinding[] {
  const out: DriftFinding[] = [];
  const harvestedPorts = new Set(h.cicd.docker.exposedPorts);

  for (const c of b.containers) {
    for (const port of c.ports ?? []) {
      if (!harvestedPorts.has(port)) {
        out.push({
          entityKind: 'container',
          driftKind: 'mismatch',
          entityId: `container:${c.id}:${String(port)}`,
          baselineRef: c.id,
          harvestedRef: null,
          detail: `Baseline container "${c.id}" expects port ${String(port)} to be exposed; harvest found no Dockerfile EXPOSE for it.`,
          severity: 'P1',
        });
      }
    }
  }

  // Extra exposed ports (only if baseline declared any containers at all)
  if (b.containers.length > 0) {
    const baselinePorts = new Set<number>();
    for (const c of b.containers) for (const p of c.ports ?? []) baselinePorts.add(p);
    for (const port of harvestedPorts) {
      if (!baselinePorts.has(port)) {
        out.push({
          entityKind: 'container',
          driftKind: 'missing-in-baseline',
          entityId: `container:port:${String(port)}`,
          baselineRef: null,
          harvestedRef: `Dockerfile EXPOSE ${String(port)}`,
          detail: `Harvest found exposed port ${String(port)} not declared by any baseline container.`,
          severity: 'P2',
        });
      }
    }
  }
  return out;
}

// ── Components ──────────────────────────────────────────────────────────────

function diffComponents(b: Baseline, h: HarvestResult): DriftFinding[] {
  const out: DriftFinding[] = [];
  if (b.components.length === 0) return out;

  // We treat baseline `owns[]` entries as expected file path prefixes.
  // If none of the harvested file paths start with any of them, the component
  // is missing in code.
  const harvestedPaths = Object.keys(h.fileRecords);

  for (const c of b.components) {
    const owns = c.owns ?? [];
    if (owns.length === 0) continue;
    const present = owns.some(prefix => harvestedPaths.some(p => p.startsWith(prefix)));
    if (!present) {
      out.push({
        entityKind: 'component',
        driftKind: 'missing-in-code',
        entityId: `component:${c.id}`,
        baselineRef: c.id,
        harvestedRef: null,
        detail: `Baseline component "${c.id}" expects files under ${owns.join(', ')} but harvest found none.`,
        severity: 'P1',
      });
    }
  }
  return out;
}

// ── Storage (baseline-side only — harvest has no native storage list yet) ───

function baselineOnlyStorage(b: Baseline, _h: HarvestResult): DriftFinding[] {
  const out: DriftFinding[] = [];
  for (const s of b.storage) {
    out.push({
      entityKind: 'storage',
      driftKind: 'missing-in-code',
      entityId: `storage:${s.id}`,
      baselineRef: s.id,
      harvestedRef: null,
      detail: `Baseline declares storage "${s.id}" (${s.kind}${s.uri ? ' ' + s.uri : ''}); storage harvester is not yet implemented so this is informational only.`,
      severity: 'P2',
    });
  }
  return out;
}

function severityRank(s: 'P0' | 'P1' | 'P2'): number {
  return s === 'P0' ? 0 : s === 'P1' ? 1 : 2;
}

import { describe, it, expect } from 'vitest';
import {
  buildDataLineage,
  renderDataLineageMermaid,
} from '../data-lineage.js';
import { makeHarvest } from '../../harvester/__tests__/fixtures.js';

const NOW = '2025-01-01T00:00:00.000Z';
const opts = { now: () => NOW };

describe('buildDataLineage', () => {
  it('emits a graph with empty nodes/edges for an empty harvest', () => {
    const g = buildDataLineage(makeHarvest(), opts);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.schemaVersion).toBe('1.0.0');
  });

  it('creates a datasource node for each DB engine', () => {
    const g = buildDataLineage(
      makeHarvest({ engines: ['postgres', 'redis'] }), opts,
    );
    const datasources = g.nodes.filter(n => n.kind === 'datasource');
    expect(datasources.map(n => n.id).sort()).toEqual(['db:postgres', 'db:redis']);
  });

  it('connects schema files to datasources with "defines" edges', () => {
    const g = buildDataLineage(
      makeHarvest({ engines: ['postgres'], schemaFiles: ['prisma/schema.prisma'] }),
      opts,
    );
    const defines = g.edges.filter(e => e.op === 'defines');
    expect(defines).toEqual([
      { from: 'db:postgres', to: 'module:prisma/schema.prisma', op: 'defines' },
    ]);
  });

  it('connects route files to route nodes with "exposes" edges', () => {
    const g = buildDataLineage(
      makeHarvest({
        apiRoutes: [{
          method: 'GET', path: '/api/users', file: 'src/routes/users.ts',
          line: 10, authRequired: false, authMethod: null, middlewareChain: [],
        }],
      }),
      opts,
    );
    const exposes = g.edges.filter(e => e.op === 'exposes');
    expect(exposes).toEqual([
      { from: 'module:src/routes/users.ts', to: 'route:GET /api/users', op: 'exposes' },
    ]);
  });

  it('traces import-graph couplings from schema files to consumers', () => {
    const g = buildDataLineage(
      makeHarvest({
        engines: ['postgres'],
        schemaFiles: ['db/schema.ts'],
        importEdges: [
          { from: 'src/repo.ts', to: 'db/schema.ts', isExternal: false, isCrossPackage: false, rawImport: './schema' },
          { from: 'src/route.ts', to: 'src/repo.ts', isExternal: false, isCrossPackage: false, rawImport: './repo' },
        ],
      }),
      opts,
    );
    const ids = g.nodes.map(n => n.id);
    expect(ids).toContain('module:src/repo.ts');
    expect(ids).toContain('module:src/route.ts');
    const imports = g.edges.filter(e => e.op === 'imports');
    expect(imports.length).toBeGreaterThanOrEqual(2);
  });

  it('produces deterministic output (sorted nodes and edges)', () => {
    const g1 = buildDataLineage(makeHarvest({ engines: ['c', 'a', 'b'] }), opts);
    const g2 = buildDataLineage(makeHarvest({ engines: ['a', 'b', 'c'] }), opts);
    expect(g1.nodes.map(n => n.id)).toEqual(g2.nodes.map(n => n.id));
    expect(g1.nodes.map(n => n.id)).toEqual([...g1.nodes.map(n => n.id)].sort());
  });

  it('deduplicates identical edges', () => {
    const g = buildDataLineage(
      makeHarvest({
        engines: ['postgres'],
        schemaFiles: ['db/schema.ts', 'db/schema.ts'],
      }),
      opts,
    );
    const defines = g.edges.filter(e => e.op === 'defines');
    expect(defines.length).toBe(1);
  });
});

describe('renderDataLineageMermaid', () => {
  it('opens with a mermaid fence and flowchart directive', () => {
    const g = buildDataLineage(makeHarvest({ engines: ['postgres'] }), opts);
    const md = renderDataLineageMermaid(g);
    expect(md).toMatch(/^```mermaid/);
    expect(md).toContain('flowchart LR');
    expect(md).toMatch(/```$/);
  });

  it('renders datasource nodes as cylinders', () => {
    const g = buildDataLineage(makeHarvest({ engines: ['postgres'] }), opts);
    const md = renderDataLineageMermaid(g);
    // Cylinder syntax: [( "label" )]
    expect(md).toMatch(/\[\("postgres"\)\]/);
  });
});

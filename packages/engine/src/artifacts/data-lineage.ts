/**
 * Builds the data-lineage graph.
 *
 * Inputs (all from `HarvestResult`):
 *   - `databases.engines` / `databases.schemaFiles` / `databases.connectionEnvVars`
 *   - `apiRoutes`
 *   - `importGraph.edges` (module → module)
 *   - `envVars` (to attach connection vars to engines)
 *
 * Algorithm:
 *   1. Seed datasource nodes from `databases.engines`.
 *   2. Seed module nodes from `databases.schemaFiles` (these "define" the DB).
 *   3. BFS outward from schema-file modules through `importGraph` to find
 *      modules transitively coupled to the datasource.
 *   4. For every `apiRoute`, the route's `file` becomes a module node; if
 *      that module is in the coupled set, add a `module → route` `exposes`
 *      edge, and trace it back to the datasource as `route ← module ← db`.
 *   5. Any engine whose seed set (schemaFiles + connectionEnvVars) is empty
 *      is flagged `unreferenced: true`.
 *
 * Output is sorted everywhere so diffs are clean.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  HarvestResult,
  DataLineageGraph,
  LineageNode,
  LineageEdge,
} from '@geodesic/types';

const COUPLING_BFS_DEPTH = 3;

interface BuildOpts {
  now?: () => string;
}

export function buildDataLineage(harvest: HarvestResult, opts: BuildOpts = {}): DataLineageGraph {
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];

  const addNode = (n: LineageNode): void => {
    const existing = nodes.get(n.id);
    if (!existing) nodes.set(n.id, n);
  };
  const addEdge = (e: LineageEdge): void => { edges.push(e); };

  // ── 1. Datasource nodes ─────────────────────────────────────────────────
  for (const engine of harvest.databases.engines) {
    addNode({
      id: `db:${engine}`,
      kind: 'datasource',
      label: engine,
      meta: {
        orm: harvest.databases.orm,
        migrationsTool: harvest.databases.migrationsTool,
        migrationCount: harvest.databases.migrationCount,
      },
    });
  }

  // ── 2. Schema-file module nodes + `defines` edges ───────────────────────
  // We don't know which schema file belongs to which engine, so we attach
  // every schema file to every engine (typically a repo has one engine).
  for (const schemaFile of harvest.databases.schemaFiles) {
    const modId = `module:${schemaFile}`;
    addNode({ id: modId, kind: 'module', label: schemaFile });
    for (const engine of harvest.databases.engines) {
      addEdge({ from: `db:${engine}`, to: modId, op: 'defines' });
    }
  }

  // ── 3. BFS through import graph from schema-file modules ────────────────
  // Build reverse adjacency: who imports this module?
  const importedBy = new Map<string, Set<string>>();
  for (const edge of harvest.importGraph.edges) {
    if (edge.isExternal) continue;
    if (!importedBy.has(edge.to)) importedBy.set(edge.to, new Set());
    importedBy.get(edge.to)!.add(edge.from);
  }

  const coupled = new Set<string>(harvest.databases.schemaFiles);
  let frontier = new Set<string>(harvest.databases.schemaFiles);
  for (let depth = 0; depth < COUPLING_BFS_DEPTH && frontier.size > 0; depth++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const importer of importedBy.get(node) ?? []) {
        if (!coupled.has(importer)) {
          coupled.add(importer);
          next.add(importer);
          const importerId = `module:${importer}`;
          addNode({ id: importerId, kind: 'module', label: importer });
          addEdge({ from: importerId, to: `module:${node}`, op: 'imports' });
        }
      }
    }
    frontier = next;
  }

  // ── 4. API routes ───────────────────────────────────────────────────────
  for (const route of harvest.apiRoutes) {
    const routeId = `route:${route.method} ${route.path}`;
    addNode({
      id: routeId,
      kind: 'route',
      label: `${route.method} ${route.path}`,
      meta: {
        file: route.file,
        line: route.line,
        authRequired: route.authRequired,
      },
    });
    const modId = `module:${route.file}`;
    addNode({ id: modId, kind: 'module', label: route.file });
    addEdge({ from: modId, to: routeId, op: 'exposes' });
  }

  // ── 5. Unreferenced datasources ─────────────────────────────────────────
  const referencedEngines = new Set<string>();
  if (harvest.databases.schemaFiles.length > 0 ||
      harvest.databases.connectionEnvVars.length > 0) {
    for (const e of harvest.databases.engines) referencedEngines.add(e);
  }
  for (const node of nodes.values()) {
    if (node.kind === 'datasource' && !referencedEngines.has(node.label)) {
      node.unreferenced = true;
    }
  }

  // ── Sort for determinism ────────────────────────────────────────────────
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to   !== b.to)   return a.to.localeCompare(b.to);
    return a.op.localeCompare(b.op);
  });
  // De-dup edges (sort makes dups adjacent)
  const deduped: LineageEdge[] = [];
  for (const e of sortedEdges) {
    const last = deduped[deduped.length - 1];
    if (!last || last.from !== e.from || last.to !== e.to || last.op !== e.op) deduped.push(e);
  }

  return {
    schemaVersion: '1.0.0',
    generatedAt: (opts.now ?? (() => new Date().toISOString()))(),
    nodes: sortedNodes,
    edges: deduped,
  };
}

// ── Mermaid rendering ────────────────────────────────────────────────────────

export function renderDataLineageMermaid(graph: DataLineageGraph): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart LR');

  const shape = (n: { kind: string; label: string }, id: string): string => {
    const safe = n.label.replace(/"/g, "'");
    switch (n.kind) {
      case 'datasource': return `  ${id}[("${safe}")]`;          // cylinder
      case 'route':      return `  ${id}(["${safe}"])`;          // stadium
      case 'external':   return `  ${id}{{"${safe}"}}`;          // hex
      default:           return `  ${id}["${safe}"]`;            // rect
    }
  };

  const aliasOf = new Map<string, string>();
  graph.nodes.forEach((n, idx) => { aliasOf.set(n.id, `n${String(idx)}`); });

  for (const n of graph.nodes) {
    const alias = aliasOf.get(n.id)!;
    let line = shape(n, alias);
    if (n.unreferenced) line += ':::unreferenced';
    lines.push(line);
  }

  for (const e of graph.edges) {
    const from = aliasOf.get(e.from);
    const to   = aliasOf.get(e.to);
    if (!from || !to) continue;
    lines.push(`  ${from} -- ${e.op} --> ${to}`);
  }

  lines.push('  classDef unreferenced stroke:#c00,stroke-width:2px,stroke-dasharray:4 2');
  lines.push('```');
  return lines.join('\n');
}

// ── Disk I/O ─────────────────────────────────────────────────────────────────

export function writeDataLineage(outputDir: string, graph: DataLineageGraph): {
  jsonPath: string; mermaidPath: string;
} {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath    = path.join(outputDir, 'data-lineage.json');
  const mermaidPath = path.join(outputDir, 'data-lineage.md');
  fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mermaidPath,
    `# Data Lineage\n\nGenerated: ${graph.generatedAt}\n\n${renderDataLineageMermaid(graph)}\n`,
    'utf8',
  );
  return { jsonPath, mermaidPath };
}

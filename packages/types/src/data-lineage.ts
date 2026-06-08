/**
 * Data Lineage Map.
 *
 * Deterministic graph of data sources (DBs, external APIs, sinks) and the
 * modules / routes that read or write them. Lets a migration team see the
 * blast radius of breaking any one data source.
 */

export type LineageNodeKind = 'datasource' | 'module' | 'route' | 'external';

export interface LineageNode {
  /** Stable id, e.g. `db:postgres`, `module:src/billing/repo.ts`, `route:GET /api/x`. */
  id: string;
  kind: LineageNodeKind;
  label: string;
  /** Optional descriptive metadata; engine-specific. */
  meta?: Record<string, string | number | boolean | null>;
  /** Datasources flagged true have no incoming/outgoing code references. */
  unreferenced?: boolean;
}

export type LineageEdgeOp =
  | 'defines'      // schema file declares the datasource
  | 'reads'        // module reads from the datasource
  | 'writes'       // module writes to the datasource
  | 'imports'      // module imports module
  | 'exposes'      // module backs a route
  | 'calls';       // module calls an external API

export interface LineageEdge {
  from: string;
  to: string;
  op: LineageEdgeOp;
}

export interface DataLineageGraph {
  schemaVersion: '1.0.0';
  generatedAt: string;
  /** Sorted ascending by `id`. */
  nodes: LineageNode[];
  /** Sorted ascending by `from` then `to` then `op`. */
  edges: LineageEdge[];
}

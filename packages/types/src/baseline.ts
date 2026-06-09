/**
 * Architectural Baseline — a typed subset of harvest reality used as the
 * gold-standard reference for drift detection. Curated from architecture
 * docs (Confluence, design specs, etc.) and committed alongside the audit.
 *
 * Drift detection is a pure structural diff (baseline vs. harvest). No LLM.
 */

export interface BaselineSourceDoc {
  title: string;
  url: string | null;
  fetchedAt: string | null;
}

export interface BaselineComponent {
  id: string;
  kind: 'service' | 'lib' | 'job' | 'frontend' | 'other';
  description?: string;
  /** Files/paths this component is expected to own. */
  owns?: string[];
}

export interface BaselineDatabase {
  id: string;
  engine: string;
  description?: string;
  schemas?: string[];
}

export interface BaselineContainer {
  id: string;
  image?: string;
  ports?: number[];
  description?: string;
}

export interface BaselineStorage {
  id: string;
  kind: 's3' | 'blob' | 'fs' | 'queue' | 'cache' | 'other';
  uri?: string;
  description?: string;
}

export interface BaselineApiRoute {
  method: string;
  path: string;
  description?: string;
}

export interface BaselineEdge {
  from: string;
  to: string;
  kind: 'http' | 'db' | 'queue' | 'event' | 'other';
}

export interface Baseline {
  schemaVersion: '1.0.0';
  name: string;
  generatedAt: string;
  sourceDocs: BaselineSourceDoc[];
  components: BaselineComponent[];
  databases: BaselineDatabase[];
  containers: BaselineContainer[];
  storage: BaselineStorage[];
  apiRoutes: BaselineApiRoute[];
  edges: BaselineEdge[];
}

// ── Drift findings ──────────────────────────────────────────────────────────

export type DriftEntityKind =
  | 'component'
  | 'database'
  | 'container'
  | 'storage'
  | 'route'
  | 'edge'
  | 'schema-table'
  | 'schema-column'
  | 'schema-index';

export type DriftKind =
  | 'missing-in-code'        // baseline declares it, harvest didn't find it
  | 'missing-in-baseline'    // harvest found it, baseline never declared it
  | 'missing-in-prod'        // dev schema declares it, prod snapshot doesn't have it
  | 'missing-in-code-schema' // prod snapshot has it, no dev migration declares it
  | 'type-changed'           // schema column type differs between dev and prod
  | 'nullability-changed'    // schema column NOT NULL ↔ NULL between dev and prod
  | 'default-changed'        // schema column default value differs between dev and prod
  | 'mismatch';              // both exist but differ on a key attribute

export type DriftSeverity = 'P0' | 'P1' | 'P2';

/** Optional code-impact reference attached to a schema-drift finding. */
export interface CodeImpactRef {
  file: string;
  line: number;
  snippet: string;
}

export interface DriftFinding {
  entityKind: DriftEntityKind;
  driftKind: DriftKind;
  entityId: string;
  baselineRef: string | null;
  harvestedRef: string | null;
  detail: string;
  severity: DriftSeverity;
  /**
   * For schema-* drift findings: code locations that reference the affected
   * table or column. Empty array if no references were found or scanning
   * was skipped. Other drift kinds leave this undefined.
   */
  codeImpact?: CodeImpactRef[];
  /** Human-actionable suggestion. Free-form, optional. */
  recommendedAction?: string;
}

export interface DriftReport {
  baselineName: string;
  baselineGeneratedAt: string;
  comparedAt: string;
  findings: DriftFinding[];
  counts: {
    p0: number;
    p1: number;
    p2: number;
    total: number;
  };
}

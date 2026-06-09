/**
 * Ops Snapshots — IT's "what's actually in production" contract.
 *
 * Mirrors the docs-ingest pattern: there's a `<repo>/ops-snapshots/` folder
 * with a README and a .gitignore. IT (or a cron job on a prod jump-box)
 * drops JSON snapshot files in. The schema-drift detector compares them
 * against the dev-side HarvestedSchema.
 *
 * The wire format is intentionally trivial JSON so it can be produced by a
 * 50-line `pg_dump`/information_schema adapter without depending on Geodesic.
 */

export type OpsSnapshotEnvironment = 'production' | 'staging' | 'uat' | 'dev' | (string & {});

export interface ProdSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
}

export interface ProdSchemaIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ProdSchemaForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface ProdSchemaTable {
  name: string;
  columns: ProdSchemaColumn[];
  indexes?: ProdSchemaIndex[];
  foreignKeys?: ProdSchemaForeignKey[];
}

export interface ProdSchemaSnapshot {
  /** Identifier of the snapshot format — bump when the wire shape changes. */
  $schema: 'geodesic-schema-snapshot-v1';
  /** Free-form label that identifies which env this came from. */
  environment: OpsSnapshotEnvironment;
  /** ISO timestamp the snapshot was captured. */
  capturedAt: string;
  /** Free-form identifier of the human or system that produced it. */
  capturedBy: string;
  /** Free-form source description (e.g. "postgres://prod-replica/app via information_schema"). */
  source: string;
  tables: ProdSchemaTable[];
}

export type OpsSnapshotFolderStatus = 'missing' | 'empty' | 'ready';

export interface OpsSnapshotsBundle {
  folderPath: string;
  status: OpsSnapshotFolderStatus;
  snapshots: Array<{
    relativePath: string;
    snapshot: ProdSchemaSnapshot;
  }>;
  /** Files we tried to parse but rejected, with the reason. */
  invalid: Array<{
    relativePath: string;
    reason: string;
  }>;
}

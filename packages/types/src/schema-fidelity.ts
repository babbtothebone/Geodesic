/**
 * Schema Fidelity types.
 *
 * Deep, deterministic inventory of every table/column/index extracted from
 * the repo's schema sources (Prisma, raw SQL migrations, schema.rb, etc.).
 *
 * This is the dev-side "what we think the database looks like" — paired
 * with a prod-side ProdSchemaSnapshot (from ops-snapshots), it powers the
 * schema-drift detector and the SCHEMA-INVENTORY.md artifact.
 *
 * Crucially, this object only contains structural metadata (names, types,
 * constraints). Any default-value strings that happen to contain literal
 * PII flow through the existing intercept scrubber unchanged.
 */

export type SchemaSourceFormat =
  | 'prisma'
  | 'sql-migration'
  | 'schema-rb'
  | 'sqlalchemy'
  | 'django-model'
  | 'drizzle'
  | 'typeorm'
  | 'unknown';

export interface HarvestedColumn {
  name: string;
  /** Raw type as it appears in the source (varchar(255), uuid, jsonb, INTEGER, …). */
  type: string;
  nullable: boolean;
  /** Raw default expression as it appears in source, or null if no default. */
  defaultValue: string | null;
  /** PRIMARY KEY, UNIQUE, NOT NULL, etc. — surface-level only, no parsing of CHECK expressions. */
  constraints: string[];
  /** Heuristic — column name suggests PII (email, ssn, dob, phone, address, …). */
  looksLikePii: boolean;
  /** Heuristic — column name suggests PHI (mrn, patient_id, diagnosis, provider, …). */
  looksLikePhi: boolean;
}

export interface HarvestedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface HarvestedForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface HarvestedTable {
  name: string;
  /** Relative path to the source file that declared this table. */
  sourceFile: string;
  sourceLine: number;
  sourceFormat: SchemaSourceFormat;
  columns: HarvestedColumn[];
  indexes: HarvestedIndex[];
  foreignKeys: HarvestedForeignKey[];
}

export interface UnparsedSchemaFile {
  path: string;
  format: SchemaSourceFormat;
  reason: string;
}

export interface HarvestedSchema {
  schemaVersion: '1.0.0';
  tables: HarvestedTable[];
  /** Files whose format we recognised but couldn't fully parse. P2 informational. */
  unparsedFiles: UnparsedSchemaFile[];
  /** Totals for fast headline rendering — derived, but precomputed for stability. */
  summary: {
    tableCount: number;
    columnCount: number;
    piiColumnCount: number;
    phiColumnCount: number;
  };
}

/**
 * Ops Snapshots Ingest — "IT drops production schema snapshots here."
 *
 * Lives at <repo>/ops-snapshots/. Mirrors the transition-docs/ pattern:
 * Geodesic creates the folder with a README, .gitignore, and an example
 * file. IT (or a cron job on a prod jump-box) periodically writes one or
 * more `*.json` snapshot files describing the production / staging / UAT
 * schema. At scan time, the schema-drift detector compares them against
 * the dev-side HarvestedSchema.
 *
 * Wire format is deliberately trivial JSON so it can be produced by a
 * 50-line pg_dump/information_schema adapter without depending on Geodesic.
 *
 * No LLM call in this module — pure filesystem + JSON.parse.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  OpsSnapshotFolderStatus,
  OpsSnapshotsBundle,
  ProdSchemaSnapshot,
  ProdSchemaTable,
} from '@geodesic/types';

export const OPS_SNAPSHOTS_DIRNAME = 'ops-snapshots';
const README_FILE = 'README.md';
const EXAMPLE_FILE = 'example.snapshot.json';
const SCAFFOLDING_FILES = new Set([README_FILE, EXAMPLE_FILE, '.gitignore', '.DS_Store']);

export function getOpsSnapshotsFolderPath(repoPath: string): string {
  return path.join(repoPath, OPS_SNAPSHOTS_DIRNAME);
}

export function getOpsSnapshotsFolderStatus(repoPath: string): OpsSnapshotFolderStatus {
  const folder = getOpsSnapshotsFolderPath(repoPath);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return 'missing';
  const dropped = listSnapshotFiles(folder);
  return dropped.length === 0 ? 'empty' : 'ready';
}

/**
 * Creates `<repo>/ops-snapshots/` with a README walking IT through the
 * snapshot format and a runnable example. Safe to call repeatedly — never
 * overwrites real user content.
 */
export function setupOpsSnapshotsFolder(repoPath: string): { folderPath: string; created: boolean } {
  const folder = getOpsSnapshotsFolderPath(repoPath);
  const created = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });

  // README — always rewrite (our content)
  fs.writeFileSync(path.join(folder, README_FILE), renderReadme(), 'utf8');

  // example.snapshot.json — only seed if missing; IT may edit / delete it
  const examplePath = path.join(folder, EXAMPLE_FILE);
  if (!fs.existsSync(examplePath)) {
    fs.writeFileSync(examplePath, JSON.stringify(renderExampleSnapshot(), null, 2) + '\n', 'utf8');
  }

  // .gitignore — production schemas often contain sensitive table/column names
  const gitignorePath = path.join(folder, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      '# Production schema snapshots may reveal sensitive internal data shapes —\n' +
        '# do not commit by default. If you want to commit specific files, add\n' +
        '# explicit !rules below.\n' +
        '*\n' +
        '!.gitignore\n' +
        '!README.md\n' +
        '!example.snapshot.json\n',
      'utf8',
    );
  }

  return { folderPath: folder, created };
}

/**
 * Reads every `*.json` snapshot file in the folder, validates the wire
 * format, and returns the bundle. Invalid files are reported in `invalid`
 * with a human-readable reason — they never silently disappear.
 */
export function collectOpsSnapshots(repoPath: string): OpsSnapshotsBundle {
  const folderPath = getOpsSnapshotsFolderPath(repoPath);
  const status = getOpsSnapshotsFolderStatus(repoPath);

  if (status === 'missing') {
    return { folderPath, status, snapshots: [], invalid: [] };
  }

  const files = listSnapshotFiles(folderPath);
  const snapshots: OpsSnapshotsBundle['snapshots'] = [];
  const invalid: OpsSnapshotsBundle['invalid'] = [];

  for (const filePath of files) {
    const relativePath = path.relative(folderPath, filePath);
    if (relativePath === EXAMPLE_FILE) continue; // skip the seeded example

    let rawText: string;
    try {
      rawText = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      invalid.push({ relativePath, reason: `Unreadable: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch (err) {
      invalid.push({ relativePath, reason: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const validated = validateSnapshot(parsedJson);
    if (typeof validated === 'string') {
      invalid.push({ relativePath, reason: validated });
      continue;
    }

    snapshots.push({ relativePath, snapshot: validated });
  }

  return { folderPath, status, snapshots, invalid };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function listSnapshotFiles(folder: string): string[] {
  const out: string[] = [];
  walk(folder, out);
  return out.sort();
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SCAFFOLDING_FILES.has(entry.name)) continue;
    if (!entry.name.endsWith('.json')) continue;
    out.push(full);
  }
}

/**
 * Returns a typed snapshot on success, or a human-readable error string on
 * failure. Validation is deliberately strict — we'd rather refuse a malformed
 * snapshot than feed garbage into the drift detector.
 */
function validateSnapshot(raw: unknown): ProdSchemaSnapshot | string {
  if (typeof raw !== 'object' || raw === null) {
    return 'Top-level value must be a JSON object';
  }
  const obj = raw as Record<string, unknown>;

  if (obj['$schema'] !== 'geodesic-schema-snapshot-v1') {
    return `Missing or unsupported "$schema" — expected "geodesic-schema-snapshot-v1", got ${JSON.stringify(obj['$schema'])}`;
  }
  if (typeof obj['environment'] !== 'string' || obj['environment'].length === 0) {
    return '"environment" must be a non-empty string';
  }
  if (typeof obj['capturedAt'] !== 'string' || obj['capturedAt'].length === 0) {
    return '"capturedAt" must be a non-empty ISO timestamp string';
  }
  if (typeof obj['capturedBy'] !== 'string') {
    return '"capturedBy" must be a string';
  }
  if (typeof obj['source'] !== 'string') {
    return '"source" must be a string';
  }
  if (!Array.isArray(obj['tables'])) {
    return '"tables" must be an array';
  }

  const tables: ProdSchemaTable[] = [];
  const rawTables = obj['tables'] as unknown[];
  for (let i = 0; i < rawTables.length; i++) {
    const validated = validateTable(rawTables[i], i);
    if (typeof validated === 'string') return validated;
    tables.push(validated);
  }

  return {
    $schema: 'geodesic-schema-snapshot-v1',
    environment: obj['environment'],
    capturedAt: obj['capturedAt'],
    capturedBy: obj['capturedBy'],
    source: obj['source'],
    tables,
  };
}

function validateTable(raw: unknown, idx: number): ProdSchemaTable | string {
  if (typeof raw !== 'object' || raw === null) {
    return `tables[${String(idx)}] must be an object`;
  }
  const t = raw as Record<string, unknown>;
  if (typeof t['name'] !== 'string' || t['name'].length === 0) {
    return `tables[${String(idx)}].name must be a non-empty string`;
  }
  if (!Array.isArray(t['columns'])) {
    return `tables[${String(idx)}].columns must be an array`;
  }

  const columns: ProdSchemaTable['columns'] = [];
  const rawCols = t['columns'] as unknown[];
  for (let j = 0; j < rawCols.length; j++) {
    const c = rawCols[j];
    if (typeof c !== 'object' || c === null) {
      return `tables[${String(idx)}].columns[${String(j)}] must be an object`;
    }
    const col = c as Record<string, unknown>;
    if (typeof col['name'] !== 'string' || col['name'].length === 0) {
      return `tables[${String(idx)}].columns[${String(j)}].name must be a non-empty string`;
    }
    if (typeof col['type'] !== 'string' || col['type'].length === 0) {
      return `tables[${String(idx)}].columns[${String(j)}].type must be a non-empty string`;
    }
    if (typeof col['nullable'] !== 'boolean') {
      return `tables[${String(idx)}].columns[${String(j)}].nullable must be a boolean`;
    }
    const defaultValue = col['defaultValue'];
    if (defaultValue !== null && typeof defaultValue !== 'string') {
      return `tables[${String(idx)}].columns[${String(j)}].defaultValue must be a string or null`;
    }
    columns.push({
      name: col['name'],
      type: col['type'],
      nullable: col['nullable'],
      defaultValue: defaultValue,
    });
  }

  const out: ProdSchemaTable = { name: t['name'], columns };

  if (Array.isArray(t['indexes'])) {
    out.indexes = [];
    for (const i of t['indexes']) {
      if (typeof i === 'object' && i !== null) {
        const idx2 = i as Record<string, unknown>;
        if (
          typeof idx2['name'] === 'string' &&
          Array.isArray(idx2['columns']) &&
          typeof idx2['unique'] === 'boolean'
        ) {
          out.indexes.push({
            name: idx2['name'],
            columns: idx2['columns'].filter((x): x is string => typeof x === 'string'),
            unique: idx2['unique'],
          });
        }
      }
    }
  }

  if (Array.isArray(t['foreignKeys'])) {
    out.foreignKeys = [];
    for (const fk of t['foreignKeys']) {
      if (typeof fk === 'object' && fk !== null) {
        const f = fk as Record<string, unknown>;
        if (
          typeof f['column'] === 'string' &&
          typeof f['referencesTable'] === 'string' &&
          typeof f['referencesColumn'] === 'string'
        ) {
          out.foreignKeys.push({
            column: f['column'],
            referencesTable: f['referencesTable'],
            referencesColumn: f['referencesColumn'],
          });
        }
      }
    }
  }

  return out;
}

function renderExampleSnapshot(): ProdSchemaSnapshot {
  return {
    $schema: 'geodesic-schema-snapshot-v1',
    environment: 'production',
    capturedAt: new Date().toISOString(),
    capturedBy: '(your-it-tool-or-cron-job)',
    source: '(e.g. postgres://prod-replica/app via information_schema)',
    tables: [
      {
        name: 'example_orders',
        columns: [
          { name: 'id', type: 'uuid', nullable: false, defaultValue: 'gen_random_uuid()' },
          { name: 'customer_id', type: 'uuid', nullable: false, defaultValue: null },
          { name: 'amount_cents', type: 'integer', nullable: false, defaultValue: '0' },
          { name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' },
        ],
        indexes: [
          { name: 'example_orders_pkey', columns: ['id'], unique: true },
          { name: 'example_orders_customer_idx', columns: ['customer_id'], unique: false },
        ],
        foreignKeys: [
          { column: 'customer_id', referencesTable: 'example_customers', referencesColumn: 'id' },
        ],
      },
    ],
  };
}

function renderReadme(): string {
  return `# Ops Snapshots — Production schema contract

This folder is where **IT publishes a periodic snapshot of what production
actually looks like**, so Geodesic can compare it against what the dev team's
code says production *should* look like.

The output is a **schema-drift report** that flags:

- Tables/columns the dev migrations create but prod doesn't have yet
- Tables/columns prod has but no dev migration declares (legacy / out-of-band changes)
- Type mismatches (\`varchar(50)\` in dev vs \`text\` in prod, etc.)
- Nullability and default-value disagreements
- Every code reference that will break if prod changes

Every drift finding is also written into the audit chain
(\`geodesic-attestation.jsonl\`) so compliance has a record.

---

## How IT publishes a snapshot

The wire format is intentionally trivial JSON. There are three ways to produce it.

### Option 1 — From any Postgres replica (one-shot)

\`\`\`bash
# Requires read-only access to information_schema on a replica
geodesic schema-snapshot \\
  --conn  "$PROD_REPLICA_DSN" \\
  --label production \\
  --out   ./ops-snapshots/schema-production.json
\`\`\`

### Option 2 — Scheduled cron on a jump-box (recommended)

\`\`\`cron
# /etc/cron.d/geodesic-schema-snapshot
# Nightly at 02:00 — read-only, no PII, only metadata
0 2 * * *  ops  geodesic schema-snapshot \\
                  --conn "$PROD_REPLICA_DSN" \\
                  --label production \\
                  --out  /srv/geodesic-snapshots/schema-production.json \\
                  --commit-and-push  ops-snapshots@github.com:focal/ops-snapshots.git
\`\`\`

### Option 3 — Hand-author or adapt from \`pg_dump\`

The format is documented below. Any internal tool that can read
\`information_schema\` can produce a valid snapshot in ~50 lines.

---

## File format

Each snapshot is a single JSON file. Filename is up to you — convention is
\`schema-<env>.json\` (e.g. \`schema-production.json\`, \`schema-staging.json\`).

\`\`\`json
{
  "$schema": "geodesic-schema-snapshot-v1",
  "environment": "production",
  "capturedAt": "2026-06-08T02:00:00Z",
  "capturedBy": "ops-cron@jump-box-1",
  "source": "postgres://prod-replica/app via information_schema",
  "tables": [
    {
      "name": "orders",
      "columns": [
        { "name": "id",          "type": "uuid",        "nullable": false, "defaultValue": "gen_random_uuid()" },
        { "name": "customer_id", "type": "uuid",        "nullable": false, "defaultValue": null },
        { "name": "total_cents", "type": "integer",     "nullable": false, "defaultValue": "0" },
        { "name": "created_at",  "type": "timestamptz", "nullable": false, "defaultValue": "now()" }
      ],
      "indexes": [
        { "name": "orders_pkey",         "columns": ["id"],         "unique": true  },
        { "name": "orders_customer_idx", "columns": ["customer_id"],"unique": false }
      ],
      "foreignKeys": [
        { "column": "customer_id", "referencesTable": "customers", "referencesColumn": "id" }
      ]
    }
  ]
}
\`\`\`

\`indexes\` and \`foreignKeys\` are optional.

A runnable starter file is sitting next to this README as \`example.snapshot.json\`.

---

## What Geodesic does with these files

On every scan, the schema-drift detector:

1. Loads every \`*.json\` snapshot in this folder
2. Diffs it against the dev-side schema extracted from Prisma / SQL migrations
3. Writes \`SCHEMA-DRIFT.md\` with one finding per divergence, severity-ranked
4. Attaches every code location that touches the affected table/column
5. Appends one row per finding to \`geodesic-attestation.jsonl\` (audit chain)
6. Exits non-zero in CI if any P0 finding is present (deploy gate)

---

## Privacy note

This folder ships with a \`.gitignore\` that excludes everything by default.
Production schemas often reveal sensitive internal data structures — keep
them in a dedicated private repo or storage if at all possible.

The snapshot files contain **only structural metadata** — no row values, no
sample data, no credentials. The schema-snapshot CLI never reads actual
table contents.
`;
}

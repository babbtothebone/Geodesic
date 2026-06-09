/**
 * Schema Extractor — deep, deterministic inventory of every table and column
 * declared in the repo's schema sources (Prisma, raw SQL migrations, schema.rb).
 *
 * Pure filesystem + regex. No LLM. No AST deps. Runs in O(file count × file size)
 * and only on files we already know are schemas.
 *
 * Security note: this module only extracts *structural metadata* (names, types,
 * constraints). Any string values it captures (e.g. column default expressions)
 * flow through the existing intercept scrubber unchanged via the standard
 * walkAndScrubInPlace path. The purity check at the end of intercept() will
 * still refuse to proceed if anything PII-shaped survived.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  FileTreeNode,
  HarvestedColumn,
  HarvestedForeignKey,
  HarvestedIndex,
  HarvestedSchema,
  HarvestedTable,
  SchemaSourceFormat,
  UnparsedSchemaFile,
} from '@geodesic/types';

// ── PII / PHI heuristics ────────────────────────────────────────────────────
// These are *name-based hints* surfaced in the inventory. They are NOT used to
// decide what to scrub — the existing detector handles scrubbing of actual
// string values. These flags help the gap-report writer surface "you have N
// columns whose names suggest PHI" so reviewers can prioritise.

const PII_NAME_PATTERNS: RegExp[] = [
  /\bemail\b/i,
  /\bphone\b/i,
  /\baddress\b/i,
  /\bstreet\b/i,
  /\bzip(code)?\b/i,
  /\bpostal\b/i,
  /\bfirst_?name\b/i,
  /\blast_?name\b/i,
  /\bfull_?name\b/i,
  /\bbirth_?date\b|\bdob\b/i,
  /\bssn\b|\bsocial_?security\b/i,
  /\btax_?id\b|\bein\b/i,
  /\bpassport\b/i,
  /\blicense_?(no|number|num)?\b/i,
  /\bcredit_?card\b|\bcc_?num\b/i,
  /\bip_?addr(ess)?\b/i,
];

const PHI_NAME_PATTERNS: RegExp[] = [
  /\bmrn\b|\bmedical_?record\b/i,
  /(?:^|[^A-Za-z])patient(?:_|$|[A-Z])/,
  /(?:^|[^A-Za-z])provider(?:_|$|[A-Z])/,
  /\bdiagnosis\b|\bicd(_?10)?\b/i,
  /\bencounter\b/i,
  /\bprescription\b|\brx\b|\bmedication\b/i,
  /\ballergy\b/i,
  /\blab_?result\b|\blab_?value\b/i,
  /\bvital_?sign\b/i,
  /\bdate_?of_?service\b|\bdos\b/i,
  /\bnpi\b/i,
  /\binsurance\b|\bpayer\b|\bplan_?id\b/i,
  /\bhealth_?plan\b/i,
];

function classifyColumnName(name: string): { looksLikePii: boolean; looksLikePhi: boolean } {
  return {
    looksLikePii: PII_NAME_PATTERNS.some(re => re.test(name)),
    looksLikePhi: PHI_NAME_PATTERNS.some(re => re.test(name)),
  };
}

// ── File selection ──────────────────────────────────────────────────────────

const MIGRATION_DIR_FRAGMENTS = [
  'migrations',
  'db/migrate',
  'database/migrations',
  'alembic/versions',
  'prisma/migrations',
];

function isMigrationSql(file: FileTreeNode): boolean {
  if (file.type !== 'file' || !file.name.endsWith('.sql')) return false;
  return MIGRATION_DIR_FRAGMENTS.some(frag => file.path.includes(frag));
}

function isPrismaSchema(file: FileTreeNode): boolean {
  return file.type === 'file' && file.name === 'schema.prisma';
}

function isSchemaRb(file: FileTreeNode): boolean {
  return file.type === 'file' && (file.name === 'schema.rb' || file.path.endsWith('db/schema.rb'));
}

function isPlainSchemaSql(file: FileTreeNode): boolean {
  return file.type === 'file' && (file.name === 'schema.sql' || (file.name.endsWith('.sql') && file.path.includes('schema')));
}

function safeRead(repoPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, relativePath), 'utf8');
  } catch {
    return null;
  }
}

// ── Prisma parser ───────────────────────────────────────────────────────────
// Parses model blocks of the form:
//   model Order {
//     id          String   @id @default(uuid())
//     customerId  String
//     amountCents Int
//     createdAt   DateTime @default(now())
//     @@index([customerId])
//   }

const PRISMA_MODEL_RE = /^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm;
const PRISMA_FIELD_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*\??(?:\[])?)\s*(.*)$/;
const PRISMA_INDEX_RE = /@@index\(\s*\[([^\]]+)\]\s*\)/g;
const PRISMA_UNIQUE_RE = /@@unique\(\s*\[([^\]]+)\]\s*\)/g;
const PRISMA_MAP_RE = /@@map\(\s*["']([^"']+)["']\s*\)/;

function parsePrismaSchema(sourceFile: string, contents: string): HarvestedTable[] {
  const tables: HarvestedTable[] = [];
  const lines = contents.split('\n');
  let match: RegExpExecArray | null;

  PRISMA_MODEL_RE.lastIndex = 0;
  while ((match = PRISMA_MODEL_RE.exec(contents)) !== null) {
    const modelName = match[1] ?? '';
    const body = match[2] ?? '';
    if (!modelName || !body) continue;
    const modelStartIdx = match.index;

    // Compute the source line by counting newlines before modelStartIdx
    const lineNumber = contents.slice(0, modelStartIdx).split('\n').length;

    // @@map("table_name") overrides the table name (Prisma convention)
    const mapMatch = PRISMA_MAP_RE.exec(body);
    const tableName = mapMatch && mapMatch[1] ? mapMatch[1] : modelName;

    const columns: HarvestedColumn[] = [];
    const indexes: HarvestedIndex[] = [];
    const foreignKeys: HarvestedForeignKey[] = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

      const fieldMatch = PRISMA_FIELD_RE.exec(line);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1] ?? '';
      const rawType = fieldMatch[2] ?? '';
      const modifiers = fieldMatch[3] ?? '';
      if (!fieldName || !rawType) continue;

      // Skip relation fields (they are not columns)
      // e.g. "customer Customer @relation(...)"
      if (/@relation\(/.test(modifiers)) {
        // Capture FK if @relation declares fields + references
        const fieldsMatch = /fields:\s*\[([^\]]+)\]/.exec(modifiers);
        const referencesMatch = /references:\s*\[([^\]]+)\]/.exec(modifiers);
        if (fieldsMatch && fieldsMatch[1] && referencesMatch && referencesMatch[1]) {
          const fkColRaw = fieldsMatch[1].split(',')[0];
          const refColRaw = referencesMatch[1].split(',')[0];
          if (fkColRaw && refColRaw) {
            foreignKeys.push({
              column: fkColRaw.trim(),
              referencesTable: rawType.replace(/[?[\]]/g, ''),
              referencesColumn: refColRaw.trim(),
            });
          }
        }
        continue;
      }

      const nullable = rawType.endsWith('?');
      const cleanType = rawType.replace(/\?$/, '');

      const constraints: string[] = [];
      if (/@id\b/.test(modifiers)) constraints.push('PRIMARY KEY');
      if (/@unique\b/.test(modifiers)) constraints.push('UNIQUE');
      if (!nullable) constraints.push('NOT NULL');

      const defaultValue = extractBalancedArg(modifiers, '@default(');

      const { looksLikePii, looksLikePhi } = classifyColumnName(fieldName);
      columns.push({
        name: fieldName,
        type: cleanType,
        nullable,
        defaultValue,
        constraints,
        looksLikePii,
        looksLikePhi,
      });
    }

    // @@index / @@unique block-level declarations
    PRISMA_INDEX_RE.lastIndex = 0;
    let idxMatch: RegExpExecArray | null;
    while ((idxMatch = PRISMA_INDEX_RE.exec(body)) !== null) {
      const colList = idxMatch[1];
      if (!colList) continue;
      indexes.push({
        name: `${tableName}_idx_${String(indexes.length + 1)}`,
        columns: colList.split(',').map(s => s.trim()),
        unique: false,
      });
    }
    PRISMA_UNIQUE_RE.lastIndex = 0;
    while ((idxMatch = PRISMA_UNIQUE_RE.exec(body)) !== null) {
      const colList = idxMatch[1];
      if (!colList) continue;
      indexes.push({
        name: `${tableName}_uniq_${String(indexes.length + 1)}`,
        columns: colList.split(',').map(s => s.trim()),
        unique: true,
      });
    }

    tables.push({
      name: tableName,
      sourceFile,
      sourceLine: lineNumber,
      sourceFormat: 'prisma',
      columns,
      indexes,
      foreignKeys,
    });
  }

  // (lines variable is intentional for future per-field line tracking)
  void lines;
  return tables;
}

// ── SQL parser ──────────────────────────────────────────────────────────────
// Parses CREATE TABLE statements. Handles common Postgres/MySQL/SQLite syntax.

const SQL_CREATE_TABLE_START_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(?:[A-Za-z_][\w.]*)"?\.)?"?([A-Za-z_][\w]*)"?\s*\(/gim;
const SQL_COLUMN_RE =
  /^\s*"?([A-Za-z_][\w]*)"?\s+([A-Za-z_][\w]*(?:\s*\([^)]*\))?(?:\s+[A-Za-z]+)*?)(\s+.*)?$/;

function parseSqlSchema(sourceFile: string, contents: string): HarvestedTable[] {
  const tables: HarvestedTable[] = [];
  let m: RegExpExecArray | null;
  SQL_CREATE_TABLE_START_RE.lastIndex = 0;

  while ((m = SQL_CREATE_TABLE_START_RE.exec(contents)) !== null) {
    const tableName = m[1] ?? '';
    if (!tableName) continue;
    // m.index + m[0].length is the position right after the opening '('
    const bodyStart = m.index + m[0].length;
    const body = extractBalancedBody(contents, bodyStart);
    if (!body) continue;
    const lineNumber = contents.slice(0, m.index).split('\n').length;

    const columns: HarvestedColumn[] = [];
    const foreignKeys: HarvestedForeignKey[] = [];

    // Split column definitions by comma at the top level (ignore commas inside parens)
    const defs = splitTopLevelByComma(body);
    for (const rawDef of defs) {
      const def = rawDef.trim();
      if (!def) continue;

      // Skip table-level constraints we want to capture separately
      if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|INDEX|KEY)\b/i.test(def)) continue;

      // Foreign key declarations: FOREIGN KEY (col) REFERENCES tbl(col)
      const fkMatch = /^FOREIGN\s+KEY\s*\(\s*"?([A-Za-z_]\w*)"?\s*\)\s+REFERENCES\s+"?([A-Za-z_]\w*)"?\s*\(\s*"?([A-Za-z_]\w*)"?\s*\)/i.exec(def);
      if (fkMatch && fkMatch[1] && fkMatch[2] && fkMatch[3]) {
        foreignKeys.push({ column: fkMatch[1], referencesTable: fkMatch[2], referencesColumn: fkMatch[3] });
        continue;
      }

      const colMatch = SQL_COLUMN_RE.exec(def);
      if (!colMatch) continue;

      const name = colMatch[1] ?? '';
      const typeRaw = colMatch[2] ?? '';
      const rest = (colMatch[3] ?? '').trim();
      if (!name || !typeRaw) continue;
      const type = typeRaw.trim();

      const nullable = !/\bNOT\s+NULL\b/i.test(rest);
      const constraints: string[] = [];
      if (/\bPRIMARY\s+KEY\b/i.test(rest)) constraints.push('PRIMARY KEY');
      if (/\bUNIQUE\b/i.test(rest)) constraints.push('UNIQUE');
      if (!nullable) constraints.push('NOT NULL');

      const defaultMatch = /\bDEFAULT\s+(.+?)(?:\s+(?:NOT\s+NULL|UNIQUE|PRIMARY|REFERENCES)|$)/i.exec(rest);
      const defaultValue = defaultMatch && defaultMatch[1] ? defaultMatch[1].trim().replace(/,$/, '') : null;

      // Inline references: col TYPE REFERENCES other_table(col)
      const inlineRefMatch = /\bREFERENCES\s+"?([A-Za-z_]\w*)"?\s*\(\s*"?([A-Za-z_]\w*)"?\s*\)/i.exec(rest);
      if (inlineRefMatch && inlineRefMatch[1] && inlineRefMatch[2]) {
        foreignKeys.push({ column: name, referencesTable: inlineRefMatch[1], referencesColumn: inlineRefMatch[2] });
      }

      const { looksLikePii, looksLikePhi } = classifyColumnName(name);
      columns.push({
        name,
        type,
        nullable,
        defaultValue,
        constraints,
        looksLikePii,
        looksLikePhi,
      });
    }

    tables.push({
      name: tableName,
      sourceFile,
      sourceLine: lineNumber,
      sourceFormat: 'sql-migration',
      columns,
      indexes: [],
      foreignKeys,
    });
  }

  return tables;
}

/**
 * Given a string and the index of the character *after* an opening '(',
 * return the substring inside the matching ')', respecting nesting. Returns
 * null if no matching paren is found.
 */
function extractBalancedBody(source: string, startAfterOpen: number): string | null {
  let depth = 1;
  for (let i = startAfterOpen; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(startAfterOpen, i);
    }
  }
  return null;
}

/**
 * Extract a balanced-paren argument that follows a literal prefix. e.g. given
 * "@id @default(uuid()) @map(\"id\")" and prefix "@default(", returns "uuid()".
 * Returns null if the prefix is absent.
 */
function extractBalancedArg(source: string, prefix: string): string | null {
  const i = source.indexOf(prefix);
  if (i === -1) return null;
  const body = extractBalancedBody(source, i + prefix.length);
  return body === null ? null : body.trim();
}

function splitTopLevelByComma(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

// ── Rails schema.rb parser ──────────────────────────────────────────────────
// Parses blocks of the form:
//   create_table "orders", force: :cascade do |t|
//     t.string "customer_id", null: false
//     t.integer "amount_cents", default: 0
//   end

const RB_CREATE_TABLE_RE = /create_table\s+["']([^"']+)["'].*?do\s*\|t\|([\s\S]*?)end/gm;
const RB_COLUMN_RE = /^\s*t\.([a-z_]+)\s+["']([A-Za-z_]\w*)["']\s*(.*)$/;

function parseSchemaRb(sourceFile: string, contents: string): HarvestedTable[] {
  const tables: HarvestedTable[] = [];
  let m: RegExpExecArray | null;
  RB_CREATE_TABLE_RE.lastIndex = 0;
  while ((m = RB_CREATE_TABLE_RE.exec(contents)) !== null) {
    const tableName = m[1] ?? '';
    const body = m[2] ?? '';
    if (!tableName || !body) continue;
    const lineNumber = contents.slice(0, m.index).split('\n').length;

    const columns: HarvestedColumn[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine;
      const colMatch = RB_COLUMN_RE.exec(line);
      if (!colMatch) continue;
      const type = colMatch[1] ?? '';
      const name = colMatch[2] ?? '';
      const rest = colMatch[3] ?? '';
      if (!type || !name) continue;
      const nullable = !/null:\s*false/.test(rest);
      const defaultMatch = /default:\s*([^,]+)/.exec(rest);
      const defaultValue = defaultMatch && defaultMatch[1] ? defaultMatch[1].trim() : null;
      const constraints: string[] = [];
      if (!nullable) constraints.push('NOT NULL');

      const { looksLikePii, looksLikePhi } = classifyColumnName(name);
      columns.push({
        name,
        type,
        nullable,
        defaultValue,
        constraints,
        looksLikePii,
        looksLikePhi,
      });
    }

    tables.push({
      name: tableName,
      sourceFile,
      sourceLine: lineNumber,
      sourceFormat: 'schema-rb',
      columns,
      indexes: [],
      foreignKeys: [],
    });
  }
  return tables;
}

// ── Public entry point ──────────────────────────────────────────────────────

export function extractSchema(repoPath: string, files: FileTreeNode[]): HarvestedSchema {
  const allTables: HarvestedTable[] = [];
  const unparsedFiles: UnparsedSchemaFile[] = [];

  // Deduplicate tables that appear in multiple migrations — keep the *latest*
  // declaration (last write wins by source-file lexicographic order, which for
  // timestamped migration filenames means newest).
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    let format: SchemaSourceFormat = 'unknown';
    let parsed: HarvestedTable[] = [];

    try {
      if (isPrismaSchema(file)) {
        format = 'prisma';
        const content = safeRead(repoPath, file.path);
        if (content === null) {
          unparsedFiles.push({ path: file.path, format, reason: 'Unreadable file' });
          continue;
        }
        parsed = parsePrismaSchema(file.path, content);
      } else if (isMigrationSql(file) || isPlainSchemaSql(file)) {
        format = 'sql-migration';
        const content = safeRead(repoPath, file.path);
        if (content === null) {
          unparsedFiles.push({ path: file.path, format, reason: 'Unreadable file' });
          continue;
        }
        parsed = parseSqlSchema(file.path, content);
      } else if (isSchemaRb(file)) {
        format = 'schema-rb';
        const content = safeRead(repoPath, file.path);
        if (content === null) {
          unparsedFiles.push({ path: file.path, format, reason: 'Unreadable file' });
          continue;
        }
        parsed = parseSchemaRb(file.path, content);
      } else {
        continue;
      }

      if (parsed.length === 0) {
        unparsedFiles.push({ path: file.path, format, reason: 'No table declarations found' });
      } else {
        allTables.push(...parsed);
      }
    } catch (err) {
      unparsedFiles.push({
        path: file.path,
        format,
        reason: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Deduplicate by table name — keep the last-seen (newest migration) version
  const byName = new Map<string, HarvestedTable>();
  for (const t of allTables) byName.set(t.name, t);
  const tables = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Compute summary
  let columnCount = 0;
  let piiColumnCount = 0;
  let phiColumnCount = 0;
  for (const t of tables) {
    for (const c of t.columns) {
      columnCount++;
      if (c.looksLikePii) piiColumnCount++;
      if (c.looksLikePhi) phiColumnCount++;
    }
  }

  return {
    schemaVersion: '1.0.0',
    tables,
    unparsedFiles,
    summary: {
      tableCount: tables.length,
      columnCount,
      piiColumnCount,
      phiColumnCount,
    },
  };
}

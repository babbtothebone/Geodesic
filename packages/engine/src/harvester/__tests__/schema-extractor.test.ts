// filepath: /Users/nicholasbabb/Desktop/Builds/geodesic-main/packages/engine/src/harvester/__tests__/schema-extractor.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractSchema } from '../schema-extractor.js';
import type { FileTreeNode } from '@geodesic/types';

function fileNode(name: string, relPath: string): FileTreeNode {
  return {
    name,
    path: relPath,
    type: 'file',
    language: null,
    sizeBytes: null,
    children: [],
    isKeyDirectory: false,
    keyDirectoryType: null,
  };
}

function writeFixture(repoPath: string, relPath: string, contents: string): void {
  const full = path.join(repoPath, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf8');
}

describe('extractSchema', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-schema-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('returns empty schema when no schema files present', () => {
    const result = extractSchema(tmpRepo, []);
    expect(result.schemaVersion).toBe('1.0.0');
    expect(result.tables).toHaveLength(0);
    expect(result.unparsedFiles).toHaveLength(0);
    expect(result.summary.tableCount).toBe(0);
  });

  describe('Prisma parser', () => {
    it('parses a simple model with columns and constraints', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);

      expect(result.tables).toHaveLength(1);
      const user = result.tables[0]!;
      expect(user.name).toBe('User');
      expect(user.sourceFormat).toBe('prisma');
      expect(user.columns).toHaveLength(4);

      const id = user.columns.find(c => c.name === 'id')!;
      expect(id.type).toBe('String');
      expect(id.nullable).toBe(false);
      expect(id.constraints).toContain('PRIMARY KEY');
      expect(id.defaultValue).toBe('uuid()');

      const email = user.columns.find(c => c.name === 'email')!;
      expect(email.constraints).toContain('UNIQUE');
      expect(email.looksLikePii).toBe(true);

      const name = user.columns.find(c => c.name === 'name')!;
      expect(name.nullable).toBe(true);
      expect(name.constraints).not.toContain('NOT NULL');
    });

    it('honors @@map for table renaming', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
model OrderLine {
  id String @id
  @@map("order_lines")
}
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);
      expect(result.tables[0]!.name).toBe('order_lines');
    });

    it('captures @@index and @@unique block-level declarations', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
model Order {
  id         String @id
  customerId String
  status     String
  @@index([customerId])
  @@unique([customerId, status])
}
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);
      const order = result.tables[0]!;
      expect(order.indexes).toHaveLength(2);
      expect(order.indexes.find(i => !i.unique)?.columns).toEqual(['customerId']);
      expect(order.indexes.find(i => i.unique)?.columns).toEqual(['customerId', 'status']);
    });

    it('extracts foreign keys from @relation', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
model Order {
  id         String   @id
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
}
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);
      const order = result.tables[0]!;
      expect(order.foreignKeys).toHaveLength(1);
      expect(order.foreignKeys[0]).toEqual({
        column: 'customerId',
        referencesTable: 'Customer',
        referencesColumn: 'id',
      });
      // relation field itself should not become a column
      expect(order.columns.find(c => c.name === 'customer')).toBeUndefined();
    });

    it('flags PHI column names', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
model Encounter {
  id        String @id
  mrn       String
  patientId String
  diagnosis String
}
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);
      const enc = result.tables[0]!;
      expect(enc.columns.find(c => c.name === 'mrn')?.looksLikePhi).toBe(true);
      expect(enc.columns.find(c => c.name === 'patientId')?.looksLikePhi).toBe(true);
      expect(enc.columns.find(c => c.name === 'diagnosis')?.looksLikePhi).toBe(true);
      expect(result.summary.phiColumnCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('SQL migration parser', () => {
    it('parses CREATE TABLE with columns, defaults, and constraints', () => {
      writeFixture(tmpRepo, 'migrations/0001_init.sql', `
CREATE TABLE customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) NOT NULL UNIQUE,
  phone        VARCHAR(20),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
      const files = [fileNode('0001_init.sql', 'migrations/0001_init.sql')];
      const result = extractSchema(tmpRepo, files);
      expect(result.tables).toHaveLength(1);
      const t = result.tables[0]!;
      expect(t.name).toBe('customers');
      expect(t.sourceFormat).toBe('sql-migration');
      expect(t.columns.find(c => c.name === 'id')?.constraints).toContain('PRIMARY KEY');
      expect(t.columns.find(c => c.name === 'email')?.nullable).toBe(false);
      expect(t.columns.find(c => c.name === 'phone')?.nullable).toBe(true);
      expect(t.columns.find(c => c.name === 'email')?.looksLikePii).toBe(true);
      expect(t.columns.find(c => c.name === 'phone')?.looksLikePii).toBe(true);
    });

    it('extracts FOREIGN KEY declarations', () => {
      writeFixture(tmpRepo, 'migrations/0002_orders.sql', `
CREATE TABLE orders (
  id          UUID PRIMARY KEY,
  customer_id UUID NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
`);
      const files = [fileNode('0002_orders.sql', 'migrations/0002_orders.sql')];
      const result = extractSchema(tmpRepo, files);
      const orders = result.tables[0]!;
      expect(orders.foreignKeys).toHaveLength(1);
      expect(orders.foreignKeys[0]).toEqual({
        column: 'customer_id',
        referencesTable: 'customers',
        referencesColumn: 'id',
      });
    });

    it('extracts inline REFERENCES declarations', () => {
      writeFixture(tmpRepo, 'migrations/0003_line.sql', `
CREATE TABLE order_lines (
  id       UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id)
);
`);
      const files = [fileNode('0003_line.sql', 'migrations/0003_line.sql')];
      const result = extractSchema(tmpRepo, files);
      const lines = result.tables[0]!;
      expect(lines.foreignKeys[0]).toEqual({
        column: 'order_id',
        referencesTable: 'orders',
        referencesColumn: 'id',
      });
    });

    it('deduplicates same table across multiple migrations (latest wins)', () => {
      // Older migration declares 2 columns
      writeFixture(tmpRepo, 'migrations/0001_users.sql', `
CREATE TABLE users (
  id    UUID PRIMARY KEY,
  email VARCHAR(255)
);
`);
      // Newer migration redeclares with an extra column — last seen wins
      writeFixture(tmpRepo, 'migrations/0002_users.sql', `
CREATE TABLE users (
  id    UUID PRIMARY KEY,
  email VARCHAR(255),
  name  VARCHAR(100)
);
`);
      const files = [
        fileNode('0001_users.sql', 'migrations/0001_users.sql'),
        fileNode('0002_users.sql', 'migrations/0002_users.sql'),
      ];
      const result = extractSchema(tmpRepo, files);
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0]!.columns).toHaveLength(3);
    });
  });

  describe('Rails schema.rb parser', () => {
    it('parses create_table blocks', () => {
      writeFixture(tmpRepo, 'db/schema.rb', `
ActiveRecord::Schema.define(version: 2024_01_01_000000) do
  create_table "patients", force: :cascade do |t|
    t.string  "mrn", null: false
    t.string  "first_name", null: false
    t.string  "last_name"
    t.integer "age", default: 0
  end
end
`);
      const files = [fileNode('schema.rb', 'db/schema.rb')];
      const result = extractSchema(tmpRepo, files);
      expect(result.tables).toHaveLength(1);
      const p = result.tables[0]!;
      expect(p.name).toBe('patients');
      expect(p.sourceFormat).toBe('schema-rb');
      expect(p.columns).toHaveLength(4);
      expect(p.columns.find(c => c.name === 'mrn')?.nullable).toBe(false);
      expect(p.columns.find(c => c.name === 'mrn')?.looksLikePhi).toBe(true);
      expect(p.columns.find(c => c.name === 'first_name')?.looksLikePii).toBe(true);
      expect(p.columns.find(c => c.name === 'last_name')?.nullable).toBe(true);
      expect(p.columns.find(c => c.name === 'age')?.defaultValue).toBe('0');
    });
  });

  describe('error handling', () => {
    it('records unparseable schema files in unparsedFiles', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
// This file has no models at all
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql" url = env("DATABASE_URL") }
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);
      expect(result.tables).toHaveLength(0);
      expect(result.unparsedFiles).toHaveLength(1);
      expect(result.unparsedFiles[0]!.format).toBe('prisma');
      expect(result.unparsedFiles[0]!.reason).toMatch(/No table declarations/);
    });

    it('ignores non-schema files', () => {
      const files = [
        fileNode('app.ts', 'src/app.ts'),
        fileNode('README.md', 'README.md'),
      ];
      const result = extractSchema(tmpRepo, files);
      expect(result.tables).toHaveLength(0);
      expect(result.unparsedFiles).toHaveLength(0);
    });
  });

  describe('summary counts', () => {
    it('accurately counts tables, columns, PII, and PHI', () => {
      writeFixture(tmpRepo, 'prisma/schema.prisma', `
model Patient {
  id        String @id
  mrn       String
  email     String
  firstName String
}

model Order {
  id     String @id
  amount Int
}
`);
      const files = [fileNode('schema.prisma', 'prisma/schema.prisma')];
      const result = extractSchema(tmpRepo, files);
      expect(result.summary.tableCount).toBe(2);
      expect(result.summary.columnCount).toBe(6);
      expect(result.summary.piiColumnCount).toBeGreaterThanOrEqual(2); // email + firstName
      expect(result.summary.phiColumnCount).toBeGreaterThanOrEqual(1); // mrn
    });
  });
});

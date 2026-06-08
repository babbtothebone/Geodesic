import { describe, expect, it } from 'vitest';
import { detectDatabases } from '../database-detector.js';
import type { DependencyManifest, FileTreeNode } from '@geodesic/types';

function makeManifest(deps: string[]): DependencyManifest {
  return {
    file: 'package.json',
    type: 'package.json',
    name: null,
    version: null,
    dependencies: deps.map(name => ({ name, version: '*', isDev: false })),
    scripts: {},
  };
}

function makeFile(name: string, filePath: string): FileTreeNode {
  return {
    name,
    path: filePath,
    type: 'file',
    language: null,
    sizeBytes: null,
    children: [],
    isKeyDirectory: false,
    keyDirectoryType: null,
  };
}

describe('detectDatabases', () => {
  it('detects PostgreSQL from pg dep', () => {
    const result = detectDatabases('.', [], [makeManifest(['pg'])]);
    expect(result.engines).toContain('PostgreSQL');
  });

  it('detects Prisma ORM and Prisma Migrate tool', () => {
    const result = detectDatabases('.', [], [makeManifest(['prisma', '@prisma/client'])]);
    expect(result.orm).toBe('Prisma');
    expect(result.migrationsTool).toBe('Prisma Migrate');
  });

  it('detects Drizzle from drizzle-orm dep', () => {
    const result = detectDatabases('.', [], [makeManifest(['drizzle-orm'])]);
    expect(result.orm).toBe('Drizzle');
  });

  it('detects Redis from ioredis dep', () => {
    const result = detectDatabases('.', [], [makeManifest(['ioredis'])]);
    expect(result.engines).toContain('Redis');
  });

  it('finds schema.prisma in schema files', () => {
    const files: FileTreeNode[] = [makeFile('schema.prisma', 'prisma/schema.prisma')];
    const result = detectDatabases('.', files, []);
    expect(result.schemaFiles).toContain('prisma/schema.prisma');
  });

  it('counts migration files', () => {
    const files: FileTreeNode[] = [
      makeFile('0001_init.sql', 'migrations/0001_init.sql'),
      makeFile('0002_users.ts', 'migrations/0002_users.ts'),
      makeFile('not-a-migration.txt', 'migrations/not-a-migration.txt'),
    ];
    const result = detectDatabases('.', files, []);
    expect(result.migrationCount).toBe(2);
  });

  it('returns empty result for no signals', () => {
    const result = detectDatabases('.', [], [makeManifest(['lodash'])]);
    expect(result.engines).toHaveLength(0);
    expect(result.orm).toBeNull();
    expect(result.migrationsTool).toBeNull();
  });
});

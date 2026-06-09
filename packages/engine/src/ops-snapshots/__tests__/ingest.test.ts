// filepath: /Users/nicholasbabb/Desktop/Builds/geodesic-main/packages/engine/src/ops-snapshots/__tests__/ingest.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectOpsSnapshots,
  getOpsSnapshotsFolderStatus,
  setupOpsSnapshotsFolder,
  OPS_SNAPSHOTS_DIRNAME,
} from '../ingest.js';
import type { ProdSchemaSnapshot } from '@geodesic/types';

const validSnapshot: ProdSchemaSnapshot = {
  $schema: 'geodesic-schema-snapshot-v1',
  environment: 'production',
  capturedAt: '2026-06-08T02:00:00.000Z',
  capturedBy: 'ops-cron@jump-box-1',
  source: 'postgres://prod-replica/app via information_schema',
  tables: [
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, defaultValue: 'gen_random_uuid()' },
        { name: 'customer_id', type: 'uuid', nullable: false, defaultValue: null },
        { name: 'amount_cents', type: 'integer', nullable: false, defaultValue: '0' },
      ],
      indexes: [
        { name: 'orders_pkey', columns: ['id'], unique: true },
      ],
      foreignKeys: [
        { column: 'customer_id', referencesTable: 'customers', referencesColumn: 'id' },
      ],
    },
  ],
};

describe('ops-snapshots ingest', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-ops-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  describe('getOpsSnapshotsFolderStatus', () => {
    it('returns "missing" when folder does not exist', () => {
      expect(getOpsSnapshotsFolderStatus(tmpRepo)).toBe('missing');
    });

    it('returns "empty" when folder exists but has only scaffolding', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      expect(getOpsSnapshotsFolderStatus(tmpRepo)).toBe('empty');
    });

    it('returns "ready" when a real snapshot file is dropped in', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      fs.writeFileSync(
        path.join(folder, 'schema-production.json'),
        JSON.stringify(validSnapshot, null, 2),
        'utf8',
      );
      expect(getOpsSnapshotsFolderStatus(tmpRepo)).toBe('ready');
    });
  });

  describe('setupOpsSnapshotsFolder', () => {
    it('creates folder with README, example, and .gitignore', () => {
      const { folderPath, created } = setupOpsSnapshotsFolder(tmpRepo);
      expect(created).toBe(true);
      expect(fs.existsSync(path.join(folderPath, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(folderPath, 'example.snapshot.json'))).toBe(true);
      expect(fs.existsSync(path.join(folderPath, '.gitignore'))).toBe(true);
    });

    it('is idempotent — repeated calls do not throw', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const second = setupOpsSnapshotsFolder(tmpRepo);
      expect(second.created).toBe(false);
    });

    it('does not overwrite a user-edited example.snapshot.json', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      const examplePath = path.join(folder, 'example.snapshot.json');
      fs.writeFileSync(examplePath, '{"user":"edited"}', 'utf8');
      setupOpsSnapshotsFolder(tmpRepo);
      expect(fs.readFileSync(examplePath, 'utf8')).toBe('{"user":"edited"}');
    });

    it('always rewrites README.md (it is our content)', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      const readmePath = path.join(folder, 'README.md');
      fs.writeFileSync(readmePath, '# user mucked with this', 'utf8');
      setupOpsSnapshotsFolder(tmpRepo);
      expect(fs.readFileSync(readmePath, 'utf8')).toContain('Ops Snapshots');
    });

    it('writes .gitignore that excludes all by default', () => {
      const { folderPath } = setupOpsSnapshotsFolder(tmpRepo);
      const gitignore = fs.readFileSync(path.join(folderPath, '.gitignore'), 'utf8');
      expect(gitignore).toContain('*');
      expect(gitignore).toContain('!.gitignore');
      expect(gitignore).toContain('!README.md');
    });
  });

  describe('collectOpsSnapshots', () => {
    it('returns missing status when folder does not exist', () => {
      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.status).toBe('missing');
      expect(bundle.snapshots).toHaveLength(0);
      expect(bundle.invalid).toHaveLength(0);
    });

    it('skips the seeded example.snapshot.json', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.status).toBe('empty');
      expect(bundle.snapshots).toHaveLength(0);
      expect(bundle.invalid).toHaveLength(0);
    });

    it('parses a valid snapshot', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      fs.writeFileSync(
        path.join(folder, 'schema-production.json'),
        JSON.stringify(validSnapshot),
        'utf8',
      );

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.status).toBe('ready');
      expect(bundle.snapshots).toHaveLength(1);
      expect(bundle.invalid).toHaveLength(0);

      const snap = bundle.snapshots[0]!;
      expect(snap.relativePath).toBe('schema-production.json');
      expect(snap.snapshot.environment).toBe('production');
      expect(snap.snapshot.tables).toHaveLength(1);
      expect(snap.snapshot.tables[0]!.name).toBe('orders');
      expect(snap.snapshot.tables[0]!.columns).toHaveLength(3);
      expect(snap.snapshot.tables[0]!.indexes).toHaveLength(1);
      expect(snap.snapshot.tables[0]!.foreignKeys).toHaveLength(1);
    });

    it('parses multiple snapshots from different environments', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      const stagingSnapshot = { ...validSnapshot, environment: 'staging' };
      fs.writeFileSync(path.join(folder, 'schema-production.json'), JSON.stringify(validSnapshot), 'utf8');
      fs.writeFileSync(path.join(folder, 'schema-staging.json'), JSON.stringify(stagingSnapshot), 'utf8');

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.snapshots).toHaveLength(2);
      const envs = bundle.snapshots.map(s => s.snapshot.environment).sort();
      expect(envs).toEqual(['production', 'staging']);
    });

    it('reports non-JSON files in invalid', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      fs.writeFileSync(path.join(folder, 'broken.json'), 'not json {{{', 'utf8');

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.snapshots).toHaveLength(0);
      expect(bundle.invalid).toHaveLength(1);
      expect(bundle.invalid[0]!.reason).toMatch(/Not valid JSON/);
    });

    it('rejects snapshots with wrong $schema version', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      fs.writeFileSync(
        path.join(folder, 'wrong.json'),
        JSON.stringify({ ...validSnapshot, $schema: 'something-else' }),
        'utf8',
      );

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.invalid).toHaveLength(1);
      expect(bundle.invalid[0]!.reason).toMatch(/\$schema/);
    });

    it('rejects snapshots missing required environment field', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      const bad = { ...validSnapshot } as Partial<ProdSchemaSnapshot>;
      delete (bad as Record<string, unknown>)['environment'];
      fs.writeFileSync(path.join(folder, 'no-env.json'), JSON.stringify(bad), 'utf8');

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.invalid).toHaveLength(1);
      expect(bundle.invalid[0]!.reason).toMatch(/environment/);
    });

    it('rejects snapshots with malformed columns', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      const bad = {
        ...validSnapshot,
        tables: [
          {
            name: 'orders',
            columns: [
              { name: 'id', type: 'uuid' /* missing nullable */ },
            ],
          },
        ],
      };
      fs.writeFileSync(path.join(folder, 'bad-columns.json'), JSON.stringify(bad), 'utf8');

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.invalid).toHaveLength(1);
      expect(bundle.invalid[0]!.reason).toMatch(/nullable/);
    });

    it('accepts snapshots without optional indexes or foreignKeys', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      const minimal = {
        $schema: 'geodesic-schema-snapshot-v1',
        environment: 'production',
        capturedAt: '2026-06-08T02:00:00.000Z',
        capturedBy: 'test',
        source: 'test',
        tables: [
          {
            name: 'minimal',
            columns: [{ name: 'id', type: 'uuid', nullable: false, defaultValue: null }],
          },
        ],
      };
      fs.writeFileSync(path.join(folder, 'minimal.json'), JSON.stringify(minimal), 'utf8');

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.snapshots).toHaveLength(1);
      expect(bundle.invalid).toHaveLength(0);
      expect(bundle.snapshots[0]!.snapshot.tables[0]!.indexes).toBeUndefined();
      expect(bundle.snapshots[0]!.snapshot.tables[0]!.foreignKeys).toBeUndefined();
    });

    it('ignores non-JSON files (e.g. README, .gitignore)', () => {
      setupOpsSnapshotsFolder(tmpRepo);
      const folder = path.join(tmpRepo, OPS_SNAPSHOTS_DIRNAME);
      fs.writeFileSync(path.join(folder, 'notes.txt'), 'random notes', 'utf8');

      const bundle = collectOpsSnapshots(tmpRepo);
      expect(bundle.snapshots).toHaveLength(0);
      expect(bundle.invalid).toHaveLength(0);
    });
  });
});

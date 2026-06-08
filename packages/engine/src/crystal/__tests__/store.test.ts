import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrystalStore, getCrystalsDir } from '../store.js';
import { makeCrystal } from './fixtures.js';

describe('getCrystalsDir', () => {
  it('returns configured dir when provided', () => {
    expect(getCrystalsDir('/custom/path')).toBe('/custom/path');
  });

  it('returns default ~/.geodesic/crystals when not provided', () => {
    const result = getCrystalsDir();
    expect(result).toBe(path.join(os.homedir(), '.geodesic', 'crystals'));
  });
});

describe('CrystalStore', () => {
  let tmpDir: string;
  let store: CrystalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-store-test-'));
    store = new CrystalStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getAll returns empty array when directory is empty', () => {
    expect(store.getAll()).toEqual([]);
  });

  it('getAll returns empty array when directory does not exist', () => {
    const missingStore = new CrystalStore(path.join(tmpDir, 'nonexistent'));
    expect(missingStore.getAll()).toEqual([]);
  });

  it('write creates crystal.json under fingerprint directory', () => {
    const crystal = makeCrystal();
    store.write(crystal);
    const expectedPath = path.join(tmpDir, crystal.stackFingerprint, 'crystal.json');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('written file contains valid JSON matching crystal', () => {
    const crystal = makeCrystal();
    store.write(crystal);
    const raw = fs.readFileSync(path.join(tmpDir, crystal.stackFingerprint, 'crystal.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    expect(parsed).toMatchObject({ crystalId: crystal.crystalId, stackFingerprint: crystal.stackFingerprint });
  });

  it('get returns crystal by fingerprint', () => {
    const crystal = makeCrystal();
    store.write(crystal);
    const found = store.get(crystal.stackFingerprint);
    expect(found).not.toBeNull();
    expect(found?.crystalId).toBe(crystal.crystalId);
  });

  it('get returns null for unknown fingerprint', () => {
    expect(store.get('unknown+unknown+unknown+unknown+unknown')).toBeNull();
  });

  it('getAll returns all written crystals', () => {
    const c1 = makeCrystal({ crystalId: 'id-1', stackFingerprint: 'typescript+hono+drizzle+jwt+docker' });
    const c2 = makeCrystal({ crystalId: 'id-2', stackFingerprint: 'python+fastapi+sqlalchemy+jwt+docker' });
    store.write(c1);
    store.write(c2);
    const all = store.getAll();
    expect(all).toHaveLength(2);
    const ids = all.map(c => c.crystalId).sort();
    expect(ids).toEqual(['id-1', 'id-2'].sort());
  });

  it('write overwrites existing crystal with same fingerprint', () => {
    const crystal = makeCrystal();
    store.write(crystal);
    const updated = { ...crystal, fitness: { ...crystal.fitness, useCount: 99 } };
    store.write(updated);
    const found = store.get(crystal.stackFingerprint);
    expect(found?.fitness.useCount).toBe(99);
  });

  it('skips directories without crystal.json when listing', () => {
    const emptyDir = path.join(tmpDir, 'empty-dir');
    fs.mkdirSync(emptyDir);
    expect(store.getAll()).toHaveLength(0);
  });

  it('skips corrupted crystal.json gracefully', () => {
    const dir = path.join(tmpDir, 'typescript+hono+drizzle+jwt+docker');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'crystal.json'), 'NOT VALID JSON', 'utf8');
    expect(store.getAll()).toHaveLength(0);
  });

  it('get returns null for corrupted crystal.json', () => {
    const dir = path.join(tmpDir, 'typescript+hono+drizzle+jwt+docker');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'crystal.json'), '{bad json', 'utf8');
    expect(store.get('typescript+hono+drizzle+jwt+docker')).toBeNull();
  });

  it('dirPath is accessible as readonly property', () => {
    expect(store.dirPath).toBe(tmpDir);
  });
});

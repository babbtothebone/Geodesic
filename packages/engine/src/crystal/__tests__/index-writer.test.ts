import { describe, it, expect } from 'vitest';
import { generateCrystalIndex, buildFitnessLogEntry } from '../index-writer.js';
import { makeCrystal, makeProbationCrystal } from './fixtures.js';

const UPDATED_AT = '2026-04-27T12:00:00Z';

describe('generateCrystalIndex', () => {
  it('includes Crystal Store Index heading', () => {
    const output = generateCrystalIndex([], UPDATED_AT);
    expect(output).toContain('# Crystal Store Index');
  });

  it('includes updatedAt timestamp in header line', () => {
    const output = generateCrystalIndex([], UPDATED_AT);
    expect(output).toContain(UPDATED_AT);
  });

  it('shows total, active, and probation counts', () => {
    const active = makeCrystal({ status: 'active' });
    const probation = makeProbationCrystal();
    const output = generateCrystalIndex([active, probation], UPDATED_AT);
    expect(output).toContain('Total crystals: 2');
    expect(output).toContain('Active: 1');
    expect(output).toContain('Probation: 1');
  });

  it('shows 0 counts for empty crystal list', () => {
    const output = generateCrystalIndex([], UPDATED_AT);
    expect(output).toContain('Total crystals: 0');
    expect(output).toContain('Active: 0');
    expect(output).toContain('Probation: 0');
  });

  it('renders markdown table header', () => {
    const output = generateCrystalIndex([], UPDATED_AT);
    expect(output).toContain('| Stack | Status | Fitness | Uses | Last Used |');
    expect(output).toContain('|---|---|---|---|---|');
  });

  it('renders each crystal as a table row', () => {
    const crystal = makeCrystal({
      stackFingerprint: 'typescript+hono+drizzle+jwt+docker',
      fitness: { useCount: 10, probationUses: 3, successCount: 9, avgTokenSavingsPct: 0.65, fitnessScore: 0.745, fitnessHistory: [] },
      lastUsedAt: '2026-04-01T00:00:00Z',
    });
    const output = generateCrystalIndex([crystal], UPDATED_AT);
    expect(output).toContain('typescript+hono+drizzle+jwt+docker');
    expect(output).toContain('Active');
    expect(output).toContain('0.74');
    expect(output).toContain('10');
    expect(output).toContain('2026-04-01');
  });

  it('sorts crystals by fitness score descending', () => {
    const low = makeCrystal({
      crystalId: 'low',
      stackFingerprint: 'python+fastapi+sqlalchemy+jwt+docker',
      fitness: { useCount: 5, probationUses: 3, successCount: 2, avgTokenSavingsPct: 0.3, fitnessScore: 0.3, fitnessHistory: [] },
    });
    const high = makeCrystal({
      crystalId: 'high',
      stackFingerprint: 'typescript+hono+drizzle+jwt+docker',
      fitness: { useCount: 10, probationUses: 3, successCount: 10, avgTokenSavingsPct: 0.8, fitnessScore: 0.95, fitnessHistory: [] },
    });
    const output = generateCrystalIndex([low, high], UPDATED_AT);
    const highIdx = output.indexOf('typescript+hono+drizzle+jwt+docker');
    const lowIdx = output.indexOf('python+fastapi+sqlalchemy+jwt+docker');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('uses em dash for null lastUsedAt', () => {
    const crystal = makeCrystal({ lastUsedAt: null });
    const output = generateCrystalIndex([crystal], UPDATED_AT);
    expect(output).toContain('| — |');
  });

  it('capitalizes status in table', () => {
    const probation = makeProbationCrystal();
    const output = generateCrystalIndex([probation], UPDATED_AT);
    expect(output).toContain('Probation');
  });

  it('ends with a trailing newline', () => {
    const output = generateCrystalIndex([], UPDATED_AT);
    expect(output.endsWith('\n')).toBe(true);
  });
});

describe('buildFitnessLogEntry', () => {
  it('includes crystal_id and fingerprint', () => {
    const crystal = makeCrystal();
    const entry = buildFitnessLogEntry(crystal, true);
    expect(entry.crystal_id).toBe(crystal.crystalId);
    expect(entry.fingerprint).toBe(crystal.stackFingerprint);
  });

  it('includes use_count and fitness_score', () => {
    const crystal = makeCrystal();
    const entry = buildFitnessLogEntry(crystal, true);
    expect(entry.use_count).toBe(crystal.fitness.useCount);
    expect(entry.fitness_score).toBe(crystal.fitness.fitnessScore);
  });

  it('includes token_savings_pct', () => {
    const crystal = makeCrystal();
    const entry = buildFitnessLogEntry(crystal, true);
    expect(entry.token_savings_pct).toBe(crystal.fitness.avgTokenSavingsPct);
  });

  it('records success: true when success=true', () => {
    const crystal = makeCrystal();
    expect(buildFitnessLogEntry(crystal, true).success).toBe(true);
  });

  it('records success: false when success=false', () => {
    const crystal = makeCrystal();
    expect(buildFitnessLogEntry(crystal, false).success).toBe(false);
  });

  it('timestamp is a valid ISO string', () => {
    const crystal = makeCrystal();
    const entry = buildFitnessLogEntry(crystal, true);
    expect(() => new Date(entry.timestamp)).not.toThrow();
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('entry is JSONL-serializable (no circular refs)', () => {
    const crystal = makeCrystal();
    const entry = buildFitnessLogEntry(crystal, true);
    expect(() => JSON.stringify(entry)).not.toThrow();
  });
});

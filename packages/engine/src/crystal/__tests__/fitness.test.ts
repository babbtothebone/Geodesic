import { describe, it, expect } from 'vitest';
import {
  computeRecency,
  computeFitnessScore,
  shouldPromote,
  shouldDeprecate,
  updateCrystalFitness,
} from '../fitness.js';
import { makeCrystal, makeProbationCrystal } from './fixtures.js';

describe('computeRecency', () => {
  it('returns 0.1 for null lastUsedAt', () => {
    expect(computeRecency(null)).toBe(0.1);
  });

  it('returns 1.0 for use within 30 days', () => {
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(computeRecency(recent)).toBe(1.0);
  });

  it('returns 0.7 for use between 30 and 90 days ago', () => {
    const midRange = new Date(Date.now() - 60 * 86_400_000).toISOString();
    expect(computeRecency(midRange)).toBe(0.7);
  });

  it('returns 0.4 for use between 90 and 180 days ago', () => {
    const older = new Date(Date.now() - 120 * 86_400_000).toISOString();
    expect(computeRecency(older)).toBe(0.4);
  });

  it('returns 0.1 for use older than 180 days', () => {
    const stale = new Date(Date.now() - 200 * 86_400_000).toISOString();
    expect(computeRecency(stale)).toBe(0.1);
  });
});

describe('computeFitnessScore', () => {
  it('returns only recency component when useCount is 0', () => {
    // successRate=0, savings=0, recency=0.1 (null lastUsedAt) → 0*0.6 + 0*0.3 + 0.1*0.1 = 0.01
    const crystal = makeCrystal({
      fitness: { useCount: 0, probationUses: 0, successCount: 0, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
      lastUsedAt: null,
    });
    expect(computeFitnessScore(crystal)).toBe(0.01);
  });

  it('computes weighted formula: successRate*0.6 + savings*0.3 + recency*0.1', () => {
    const crystal = makeCrystal({
      fitness: { useCount: 10, probationUses: 3, successCount: 10, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
      lastUsedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    // successRate=1.0, savings=0.0, recency=1.0 → 0.6 + 0 + 0.1 = 0.7
    expect(computeFitnessScore(crystal)).toBe(0.7);
  });

  it('all components at max gives 1.0', () => {
    const crystal = makeCrystal({
      fitness: { useCount: 10, probationUses: 3, successCount: 10, avgTokenSavingsPct: 1.0, fitnessScore: 0, fitnessHistory: [] },
      lastUsedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    expect(computeFitnessScore(crystal)).toBe(1.0);
  });

  it('partial success rate reduces score', () => {
    const crystal = makeCrystal({
      fitness: { useCount: 10, probationUses: 3, successCount: 5, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
      lastUsedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    // successRate=0.5, savings=0, recency=1.0 → 0.3 + 0 + 0.1 = 0.4
    expect(computeFitnessScore(crystal)).toBe(0.4);
  });
});

describe('shouldPromote', () => {
  it('promotes probation crystal with 3+ probation uses and success', () => {
    const crystal = makeProbationCrystal({
      fitness: { useCount: 3, probationUses: 3, successCount: 2, avgTokenSavingsPct: 0.5, fitnessScore: 0.7, fitnessHistory: [] },
    });
    expect(shouldPromote(crystal)).toBe(true);
  });

  it('does not promote if probationUses < 3', () => {
    const crystal = makeProbationCrystal({
      fitness: { useCount: 2, probationUses: 2, successCount: 2, avgTokenSavingsPct: 0.5, fitnessScore: 0.7, fitnessHistory: [] },
    });
    expect(shouldPromote(crystal)).toBe(false);
  });

  it('does not promote if successCount is 0', () => {
    const crystal = makeProbationCrystal({
      fitness: { useCount: 3, probationUses: 3, successCount: 0, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
    });
    expect(shouldPromote(crystal)).toBe(false);
  });

  it('does not promote active crystals', () => {
    const crystal = makeCrystal({
      status: 'active',
      fitness: { useCount: 5, probationUses: 5, successCount: 5, avgTokenSavingsPct: 0.8, fitnessScore: 0.9, fitnessHistory: [] },
    });
    expect(shouldPromote(crystal)).toBe(false);
  });
});

describe('shouldDeprecate', () => {
  it('deprecates probation crystal after 5 uses with no successes', () => {
    const crystal = makeProbationCrystal({
      fitness: { useCount: 5, probationUses: 5, successCount: 0, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
    });
    expect(shouldDeprecate(crystal, 0)).toBe(true);
  });

  it('does not deprecate probation crystal with fewer than 5 uses', () => {
    const crystal = makeProbationCrystal({
      fitness: { useCount: 4, probationUses: 4, successCount: 0, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
    });
    expect(shouldDeprecate(crystal, 0)).toBe(false);
  });

  it('deprecates active crystal after 5 consecutive low-fitness uses with low score', () => {
    const crystal = makeCrystal({
      status: 'active',
      fitness: { useCount: 10, probationUses: 3, successCount: 3, avgTokenSavingsPct: 0, fitnessScore: 0.2, fitnessHistory: [] },
      lastUsedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    expect(shouldDeprecate(crystal, 5)).toBe(true);
  });

  it('does not deprecate active crystal if fitness score is above 0.4', () => {
    const crystal = makeCrystal({
      status: 'active',
      fitness: { useCount: 10, probationUses: 3, successCount: 8, avgTokenSavingsPct: 0.6, fitnessScore: 0.8, fitnessHistory: [] },
      lastUsedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    expect(shouldDeprecate(crystal, 5)).toBe(false);
  });

  it('deprecates active crystal unused for 180+ days', () => {
    const crystal = makeCrystal({
      status: 'active',
      lastUsedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    });
    expect(shouldDeprecate(crystal, 0)).toBe(true);
  });

  it('does not deprecate deprecated crystal (returns false)', () => {
    const crystal = makeCrystal({ status: 'deprecated' });
    expect(shouldDeprecate(crystal, 10)).toBe(false);
  });
});

describe('updateCrystalFitness', () => {
  const NOW = '2026-04-27T12:00:00Z';

  it('increments useCount and successCount on success', () => {
    const crystal = makeCrystal();
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    expect(updated.fitness.useCount).toBe(crystal.fitness.useCount + 1);
    expect(updated.fitness.successCount).toBe(crystal.fitness.successCount + 1);
  });

  it('increments useCount but not successCount on failure', () => {
    const crystal = makeCrystal();
    const updated = updateCrystalFitness(crystal, false, 0.0, NOW);
    expect(updated.fitness.useCount).toBe(crystal.fitness.useCount + 1);
    expect(updated.fitness.successCount).toBe(crystal.fitness.successCount);
  });

  it('increments probationUses for probation crystals', () => {
    const crystal = makeProbationCrystal();
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    expect(updated.fitness.probationUses).toBe(crystal.fitness.probationUses + 1);
  });

  it('does not change probationUses for active crystals', () => {
    const crystal = makeCrystal({ status: 'active' });
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    expect(updated.fitness.probationUses).toBe(crystal.fitness.probationUses);
  });

  it('updates lastUsedAt and updatedAt to now', () => {
    const crystal = makeCrystal();
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    expect(updated.lastUsedAt).toBe(NOW);
    expect(updated.updatedAt).toBe(NOW);
  });

  it('appends a fitnessHistory entry', () => {
    const crystal = makeCrystal();
    const prevLen = crystal.fitness.fitnessHistory.length;
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    expect(updated.fitness.fitnessHistory).toHaveLength(prevLen + 1);
  });

  it('promotes probation crystal that meets criteria after update', () => {
    const crystal = makeProbationCrystal({
      fitness: { useCount: 2, probationUses: 2, successCount: 2, avgTokenSavingsPct: 0.5, fitnessScore: 0.7, fitnessHistory: [] },
    });
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    // After update: probationUses=3, successCount=3 → should promote
    expect(updated.status).toBe('active');
  });

  it('computes rolling average for avgTokenSavingsPct', () => {
    const crystal = makeCrystal({
      fitness: { useCount: 4, probationUses: 3, successCount: 4, avgTokenSavingsPct: 0.5, fitnessScore: 0.7, fitnessHistory: [] },
    });
    const updated = updateCrystalFitness(crystal, true, 1.0, NOW);
    // rolling avg: (0.5*4 + 1.0) / 5 = 3.0/5 = 0.6
    expect(updated.fitness.avgTokenSavingsPct).toBeCloseTo(0.6, 3);
  });

  it('recomputes fitnessScore after update', () => {
    const crystal = makeCrystal();
    const updated = updateCrystalFitness(crystal, true, 0.5, NOW);
    expect(updated.fitness.fitnessScore).toBeGreaterThan(0);
  });
});

describe('updateCrystalFitness — no prior uses edge case', () => {
  const NOW = '2026-04-27T12:00:00Z';

  it('uses tokenSavingsPct directly when first use (prevCount = 0)', () => {
    const crystal = makeCrystal({
      fitness: { useCount: 0, probationUses: 0, successCount: 0, avgTokenSavingsPct: 0, fitnessScore: 0, fitnessHistory: [] },
    });
    const updated = updateCrystalFitness(crystal, true, 0.7, NOW);
    expect(updated.fitness.avgTokenSavingsPct).toBeCloseTo(0.7, 3);
  });
});

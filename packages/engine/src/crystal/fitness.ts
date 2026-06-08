import type { Crystal } from '@geodesic/types';

export function computeRecency(lastUsedAt: string | null): number {
  if (!lastUsedAt) return 0.1;
  const daysSince = (Date.now() - new Date(lastUsedAt).getTime()) / 86_400_000;
  if (daysSince < 30) return 1.0;
  if (daysSince < 90) return 0.7;
  if (daysSince < 180) return 0.4;
  return 0.1;
}

export function computeFitnessScore(crystal: Crystal): number {
  const successRate = crystal.fitness.useCount > 0
    ? crystal.fitness.successCount / crystal.fitness.useCount
    : 0;
  const tokenSavings = crystal.fitness.avgTokenSavingsPct;
  const recency = computeRecency(crystal.lastUsedAt);
  return parseFloat((successRate * 0.6 + tokenSavings * 0.3 + recency * 0.1).toFixed(4));
}

export function shouldPromote(crystal: Crystal): boolean {
  return (
    crystal.status === 'probation' &&
    crystal.fitness.probationUses >= 3 &&
    crystal.fitness.successCount > 0
  );
}

export function shouldDeprecate(crystal: Crystal, consecutiveLowFitnessUses: number): boolean {
  if (crystal.status === 'probation') {
    return crystal.fitness.useCount >= 5 && crystal.fitness.successCount === 0;
  }
  if (crystal.status === 'active') {
    if (consecutiveLowFitnessUses >= 5 && computeFitnessScore(crystal) < 0.4) return true;
    if (crystal.lastUsedAt) {
      const daysSince = (Date.now() - new Date(crystal.lastUsedAt).getTime()) / 86_400_000;
      if (daysSince >= 180) return true;
    }
  }
  return false;
}

export function updateCrystalFitness(
  crystal: Crystal,
  success: boolean,
  tokenSavingsPct: number,
  now: string,
): Crystal {
  const newUseCount = crystal.fitness.useCount + 1;
  const newSuccessCount = crystal.fitness.successCount + (success ? 1 : 0);
  const newProbationUses = crystal.status === 'probation'
    ? crystal.fitness.probationUses + 1
    : crystal.fitness.probationUses;

  const prevSavings = crystal.fitness.avgTokenSavingsPct;
  const prevCount = crystal.fitness.useCount;
  const newAvgSavings = prevCount > 0
    ? (prevSavings * prevCount + tokenSavingsPct) / newUseCount
    : tokenSavingsPct;

  const updated: Crystal = {
    ...crystal,
    lastUsedAt: now,
    updatedAt: now,
    fitness: {
      useCount: newUseCount,
      probationUses: newProbationUses,
      successCount: newSuccessCount,
      avgTokenSavingsPct: parseFloat(newAvgSavings.toFixed(4)),
      fitnessScore: 0,
      fitnessHistory: [
        ...crystal.fitness.fitnessHistory,
        {
          date: now.slice(0, 10),
          score: crystal.fitness.fitnessScore,
          useCount: crystal.fitness.useCount,
        },
      ],
    },
  };

  updated.fitness.fitnessScore = computeFitnessScore(updated);
  if (shouldPromote(updated)) updated.status = 'active';
  return updated;
}

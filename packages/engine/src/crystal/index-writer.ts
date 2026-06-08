import type { Crystal } from '@geodesic/types';

export function generateCrystalIndex(crystals: Crystal[], updatedAt: string): string {
  const total = crystals.length;
  const active = crystals.filter(c => c.status === 'active').length;
  const probation = crystals.filter(c => c.status === 'probation').length;

  const lines: string[] = [];
  lines.push('# Crystal Store Index');
  lines.push(
    `Last updated: ${updatedAt} | Total crystals: ${String(total)} | Active: ${String(active)} | Probation: ${String(probation)}`,
  );
  lines.push('');
  lines.push('| Stack | Status | Fitness | Uses | Last Used |');
  lines.push('|---|---|---|---|---|');

  const sorted = [...crystals].sort((a, b) => b.fitness.fitnessScore - a.fitness.fitnessScore);
  for (const crystal of sorted) {
    const lastUsed = crystal.lastUsedAt ? crystal.lastUsedAt.slice(0, 10) : '—';
    const status = crystal.status.charAt(0).toUpperCase() + crystal.status.slice(1);
    lines.push(
      `| ${crystal.stackFingerprint} | ${status} | ${crystal.fitness.fitnessScore.toFixed(2)} | ${String(crystal.fitness.useCount)} | ${lastUsed} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export interface FitnessLogEntry {
  timestamp: string;
  crystal_id: string;
  fingerprint: string;
  use_count: number;
  fitness_score: number;
  token_savings_pct: number;
  success: boolean;
}

export function buildFitnessLogEntry(crystal: Crystal, success: boolean): FitnessLogEntry {
  return {
    timestamp: new Date().toISOString(),
    crystal_id: crystal.crystalId,
    fingerprint: crystal.stackFingerprint,
    use_count: crystal.fitness.useCount,
    fitness_score: crystal.fitness.fitnessScore,
    token_savings_pct: crystal.fitness.avgTokenSavingsPct,
    success,
  };
}

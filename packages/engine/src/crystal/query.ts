import type { Crystal, CrystalQueryResult } from '@geodesic/types';
import { parseFingerprint } from './fingerprint.js';

// Segments within the same group receive partial credit (0.5) in fuzzy matching
const RELATED_GROUPS: string[][] = [
  // TypeScript/JS ORMs
  ['drizzle', 'prisma', 'typeorm', 'sequelize', 'mikroorm'],
  // Python ORMs
  ['sqlalchemy', 'tortoise', 'peewee', 'django'],
  // Ruby ORMs
  ['activerecord', 'sequel'],
  // Next.js-family JS frameworks
  ['nextjs', 'nuxt', 'remix', 'sveltekit'],
  // Node.js HTTP frameworks
  ['express', 'hono', 'fastify', 'koa', 'nestjs'],
  // Python frameworks
  ['fastapi', 'flask', 'django'],
  // Ruby frameworks
  ['rails', 'sinatra'],
  // Auth strategies
  ['jwt', 'session', 'oauth', 'nextauth', 'devise', 'sanctum', 'passport'],
  // Container-based deployment
  ['docker', 'nginx'],
  // Orchestrated deployment
  ['kubernetes', 'helm'],
];

function inSameGroup(a: string, b: string): boolean {
  return RELATED_GROUPS.some(g => g.includes(a) && g.includes(b));
}

export function computeSegmentSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a === 'unknown' || b === 'unknown') return 0.3;
  if (inSameGroup(a, b)) return 0.5;
  return 0.0;
}

export function computeFuzzySimilarity(fingerprintA: string, fingerprintB: string): number {
  const segsA = parseFingerprint(fingerprintA);
  const segsB = parseFingerprint(fingerprintB);
  const len = Math.max(segsA.length, segsB.length);
  if (len === 0) return 1.0;

  let total = 0;
  for (let i = 0; i < len; i++) {
    const a = segsA[i] ?? 'unknown';
    const b = segsB[i] ?? 'unknown';
    total += computeSegmentSimilarity(a, b);
  }
  return total / len;
}

export function queryCrystal(fingerprint: string, crystals: Crystal[]): CrystalQueryResult {
  const eligible = crystals.filter(c => c.status !== 'deprecated');

  // 1. Exact match
  const exact = eligible.find(c => c.stackFingerprint === fingerprint);
  if (exact) {
    return { crystal: exact, matchScore: 1.0, matchType: 'exact' };
  }

  // 2. Fuzzy match — best score at or above threshold
  const THRESHOLD = 0.92;
  let bestCrystal: Crystal | null = null;
  let bestScore = 0;

  for (const c of eligible) {
    const score = computeFuzzySimilarity(fingerprint, c.stackFingerprint);
    if (score >= THRESHOLD && score > bestScore) {
      bestScore = score;
      bestCrystal = c;
    }
  }

  if (bestCrystal !== null) {
    // Break ties by fitness score
    const finalBestScore = bestScore;
    const tied = eligible.filter(
      c => computeFuzzySimilarity(fingerprint, c.stackFingerprint) === finalBestScore,
    );
    const winner = tied.reduce((best, c) =>
      c.fitness.fitnessScore > best.fitness.fitnessScore ? c : best,
    );
    return { crystal: winner, matchScore: finalBestScore, matchType: 'fuzzy' };
  }

  return { crystal: null, matchScore: 0, matchType: 'none' };
}

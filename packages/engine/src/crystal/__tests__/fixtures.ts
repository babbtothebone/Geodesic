import type { Crystal } from '@geodesic/types';

export function makeCrystal(overrides: Partial<Crystal> = {}): Crystal {
  const base: Crystal = {
    schemaVersion: '1',
    crystalId: 'test-crystal-id-001',
    stackFingerprint: 'typescript+hono+drizzle+jwt+docker',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    lastUsedAt: '2026-04-01T00:00:00Z',
    fitness: {
      useCount: 10,
      probationUses: 3,
      successCount: 9,
      avgTokenSavingsPct: 0.65,
      fitnessScore: 0.745,
      fitnessHistory: [
        { date: '2026-03-01', score: 0.70, useCount: 7 },
        { date: '2026-04-01', score: 0.74, useCount: 9 },
      ],
    },
    stackPatterns: {
      typicalEntryPoints: ['http_server: Main Hono app server'],
      typicalLayerStructure: 'API Routes: HTTP handling → Data Layer: Drizzle ORM',
      typicalAuthPattern: 'JWT + httponly cookie',
      typicalDbPattern: 'PostgreSQL with Drizzle ORM',
      typicalTestPattern: 'Vitest for unit and integration tests',
      typicalInfraPattern: 'Docker Compose with GitHub Actions',
    },
    analysisSequence: [
      'Identify primary language and framework from dependency manifests',
      'Map entry points and primary routing mechanism',
      'Inspect database schema and ORM configuration for data model patterns',
      'Trace authentication flow from middleware to route protection',
    ],
    commonGaps: [
      { dimension: 'Security', gap: 'No rate limiting on auth endpoints', severity: 'P1', frequency: 0.8 },
      { dimension: 'Observability', gap: 'No health check endpoint', severity: 'P1', frequency: 0.6 },
    ],
    bootstrapPrompt: 'This codebase uses the typescript+hono+drizzle+jwt+docker stack.',
    ...overrides,
  };
  return base;
}

export function makeProbationCrystal(overrides: Partial<Crystal> = {}): Crystal {
  return makeCrystal({
    status: 'probation',
    fitness: {
      useCount: 2,
      probationUses: 2,
      successCount: 1,
      avgTokenSavingsPct: 0.3,
      fitnessScore: 0.49,
      fitnessHistory: [],
    },
    ...overrides,
  });
}

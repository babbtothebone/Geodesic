import { describe, it, expect } from 'vitest';
import { computeFingerprint, normalizeFingerprint, parseFingerprint } from '../fingerprint.js';
import type { HarvestResult } from '@geodesic/types';

function makeHarvest(overrides: Partial<HarvestResult> = {}): HarvestResult {
  const base: HarvestResult = {
    meta: {
      repoPath: '/tmp/test',
      repoName: 'test-repo',
      repoCommit: null,
      harvestedAt: '2026-04-27T00:00:00Z',
      harvestDurationMs: 100,
      totalFiles: 10,
      binaryFiles: 0,
      generatedFiles: 0,
      dataFiles: 0,
      errorFiles: 0,
      symlinkCount: 0,
    },
    monorepoPackages: [],
    languages: { primary: 'TypeScript', all: [{ language: 'TypeScript', fileCount: 10 }] },
    framework: { primary: 'hono', all: ['hono'], isMonorepo: false, monoRepoTool: null },
    fileTree: [],
    fileRecords: {},
    dependencies: [],
    importGraph: { edges: [], hubFiles: [], entryPoints: [], leafFiles: [], circularCycles: [] },
    apiRoutes: [],
    databases: { engines: [], orm: null, migrationsTool: null, migrationCount: 0, schemaFiles: [], connectionEnvVars: [] },
    envVars: [],
    auth: { patterns: [] },
    cicd: {
      githubActions: [],
      docker: { hasDockerfile: false, hasCompose: false, exposedPorts: [] },
      kubernetes: false,
      helm: false,
      makefile: { present: false, targets: [] },
      deploymentTargets: [],
    },
    tests: { testFileCount: 0, frameworks: [], coverageToolingPresent: false, coverageDirectoryPresent: false },
    piiCandidateLocations: [],
    ...overrides,
  };
  return base;
}

describe('computeFingerprint', () => {
  it('produces 5-segment + delimited fingerprint', () => {
    const harvest = makeHarvest({
      databases: { engines: ['PostgreSQL'], orm: 'drizzle-orm', migrationsTool: null, migrationCount: 0, schemaFiles: [], connectionEnvVars: [] },
      auth: { patterns: [{ type: 'jwt', keyFiles: [], coversAllRoutes: true }] },
      cicd: {
        githubActions: [],
        docker: { hasDockerfile: true, hasCompose: false, exposedPorts: [] },
        kubernetes: false,
        helm: false,
        makefile: { present: false, targets: [] },
        deploymentTargets: [],
      },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.split('+')).toHaveLength(5);
  });

  it('normalizes drizzle-orm alias to drizzle', () => {
    const harvest = makeHarvest({
      databases: { engines: ['PostgreSQL'], orm: 'drizzle-orm', migrationsTool: null, migrationCount: 0, schemaFiles: [], connectionEnvVars: [] },
    });
    const fp = computeFingerprint(harvest);
    expect(fp).toContain('+drizzle+');
  });

  it('normalizes @prisma/client to prisma', () => {
    const harvest = makeHarvest({
      databases: { engines: ['PostgreSQL'], orm: '@prisma/client', migrationsTool: null, migrationCount: 0, schemaFiles: [], connectionEnvVars: [] },
    });
    const fp = computeFingerprint(harvest);
    expect(fp).toContain('+prisma+');
  });

  it('normalizes next.js framework alias to nextjs', () => {
    const harvest = makeHarvest({
      framework: { primary: 'next.js', all: ['next.js'], isMonorepo: false, monoRepoTool: null },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.startsWith('typescript+nextjs+') || fp.split('+')[1] === 'nextjs').toBe(true);
  });

  it('maps jwt auth pattern correctly', () => {
    const harvest = makeHarvest({
      auth: { patterns: [{ type: 'jwt', keyFiles: [], coversAllRoutes: true }] },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.split('+')).toContain('jwt');
  });

  it('uses unknown for missing auth', () => {
    const harvest = makeHarvest({ auth: { patterns: [] } });
    const fp = computeFingerprint(harvest);
    expect(fp.split('+')).toContain('unknown');
  });

  it('resolves kubernetes deployment when kubernetes: true', () => {
    const harvest = makeHarvest({
      cicd: {
        githubActions: [],
        docker: { hasDockerfile: true, hasCompose: false, exposedPorts: [] },
        kubernetes: true,
        helm: false,
        makefile: { present: false, targets: [] },
        deploymentTargets: [],
      },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.endsWith('+kubernetes')).toBe(true);
  });

  it('resolves docker when hasDockerfile and no kubernetes', () => {
    const harvest = makeHarvest({
      cicd: {
        githubActions: [],
        docker: { hasDockerfile: true, hasCompose: false, exposedPorts: [] },
        kubernetes: false,
        helm: false,
        makefile: { present: false, targets: [] },
        deploymentTargets: [],
      },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.endsWith('+docker')).toBe(true);
  });

  it('resolves vercel from deploymentTargets', () => {
    const harvest = makeHarvest({
      cicd: {
        githubActions: [],
        docker: { hasDockerfile: false, hasCompose: false, exposedPorts: [] },
        kubernetes: false,
        helm: false,
        makefile: { present: false, targets: [] },
        deploymentTargets: ['Vercel'],
      },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.endsWith('+vercel')).toBe(true);
  });

  it('strips version numbers from language segment', () => {
    const harvest = makeHarvest({
      languages: { primary: 'TypeScript 5.0', all: [{ language: 'TypeScript 5.0', fileCount: 10 }] },
    });
    const fp = computeFingerprint(harvest);
    expect(fp.startsWith('typescript+')).toBe(true);
    expect(fp).not.toContain('5.0');
  });
});

describe('normalizeFingerprint', () => {
  it('lowercases all segments', () => {
    expect(normalizeFingerprint('TypeScript+Hono+Drizzle+JWT+Docker')).toBe('typescript+hono+drizzle+jwt+docker');
  });

  it('strips version numbers from each segment', () => {
    expect(normalizeFingerprint('typescript+hono4+drizzle+jwt+docker')).toBe('typescript+hono+drizzle+jwt+docker');
  });

  it('returns unknown for empty segments', () => {
    expect(normalizeFingerprint('+hono+drizzle+jwt+docker')).toBe('unknown+hono+drizzle+jwt+docker');
  });
});

describe('parseFingerprint', () => {
  it('splits on + into 5 segments', () => {
    const segs = parseFingerprint('typescript+hono+drizzle+jwt+docker');
    expect(segs).toEqual(['typescript', 'hono', 'drizzle', 'jwt', 'docker']);
  });

  it('handles fingerprints with fewer segments gracefully', () => {
    const segs = parseFingerprint('typescript+hono');
    expect(segs).toHaveLength(2);
  });
});

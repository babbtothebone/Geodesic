import { describe, expect, it } from 'vitest';
import { intercept } from '../scrubber.js';
import type { HarvestResult } from '@geodesic/types';

function makeMinimalHarvest(): HarvestResult {
  return {
    meta: {
      repoPath: '/projects/clean-repo',
      repoName: 'clean-repo',
      repoCommit: 'abc123',
      harvestedAt: '2026-04-27T00:00:00.000Z',
      harvestDurationMs: 100,
      totalFiles: 5,
      binaryFiles: 0,
      generatedFiles: 0,
      dataFiles: 0,
      errorFiles: 0,
      symlinkCount: 0,
    },
    monorepoPackages: [],
    languages: { primary: 'TypeScript', all: [{ language: 'TypeScript', fileCount: 5 }] },
    framework: { primary: 'Next.js', all: ['Next.js'], isMonorepo: false, monoRepoTool: null },
    fileTree: [],
    fileRecords: {},
    dependencies: [],
    importGraph: { edges: [], hubFiles: [], entryPoints: [], leafFiles: [], circularCycles: [] },
    apiRoutes: [],
    databases: { engines: [], orm: null, migrationsTool: null, migrationCount: 0, schemaFiles: [], connectionEnvVars: [] },
    envVars: [],
    auth: { patterns: [{ type: 'jwt', keyFiles: [], coversAllRoutes: false }] },
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
  };
}

const CTX = { analystId: 'test@example.com', repo: 'test/repo', repoCommit: 'abc123' };

describe('intercept — clean harvest', () => {
  it('passes a clean harvest with no detections', () => {
    const result = intercept(makeMinimalHarvest(), CTX);
    expect(result.purityVerified).toBe(true);
    expect(result.attestationEntries).toHaveLength(0);
    expect(result.piiCount).toBe(0);
    expect(result.phiCount).toBe(0);
    expect(result.secretCount).toBe(0);
  });

  it('returns the scrubbed harvest object and a payload hash', () => {
    const result = intercept(makeMinimalHarvest(), CTX);
    expect(result.scrubbedHarvest).toBeDefined();
    expect(result.scrubbedHarvest.meta.repoName).toBe('clean-repo');
    expect(result.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('mutates the input harvest in place (same object identity)', () => {
    const harvest = makeMinimalHarvest();
    const result = intercept(harvest, CTX);
    expect(result.scrubbedHarvest).toBe(harvest);
  });
});

describe('intercept — PII in harvest values', () => {
  it('scrubs an email address found in a non-structural field', () => {
    const harvest = makeMinimalHarvest();
    harvest.envVars = [{
      name: 'CONTACT',
      file: '.env',
      hasValue: true,
      isTemplate: false,
      inferredPurpose: 'admin@hospital.org is the contact',
      isSecret: false,
    }];

    const result = intercept(harvest, CTX);
    expect(result.purityVerified).toBe(true);
    expect(result.attestationEntries.length).toBeGreaterThan(0);

    const purpose = result.scrubbedHarvest.envVars[0]?.inferredPurpose ?? '';
    expect(purpose).not.toContain('@hospital.org');
    expect(purpose).toMatch(/\[PHI:EMAIL:ref:[a-z0-9]{4}:CONF:HIGH\]/);
  });

  it('scrubs a connection string', () => {
    const harvest = makeMinimalHarvest();
    harvest.envVars = [{
      name: 'DATABASE_URL',
      file: '.env',
      hasValue: true,
      isTemplate: false,
      inferredPurpose: 'Database: postgres://admin:hunter2@db.internal/prod',
      isSecret: true,
    }];

    const result = intercept(harvest, CTX);
    expect(result.purityVerified).toBe(true);
    expect(result.scrubbedHarvest.envVars[0]?.inferredPurpose).not.toContain('hunter2');
    expect(result.secretCount).toBeGreaterThan(0);
  });

  it('produces correct attestation entry fields', () => {
    const harvest = makeMinimalHarvest();
    harvest.envVars = [{
      name: 'X',
      file: '.env',
      hasValue: true,
      isTemplate: false,
      inferredPurpose: 'admin@hospital.org',
      isSecret: false,
    }];

    const result = intercept(harvest, CTX);
    const entry = result.attestationEntries[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    expect(entry.piiCategory).toBe('PHI');
    expect(entry.piiType).toBe('EMAIL');
    expect(entry.scrubAction).toBe('REPLACED_WITH_TOKEN');
    expect(entry.tokenPlaced).toMatch(/^\[PHI:EMAIL:ref:[a-z0-9]{4}:CONF:HIGH\]$/);
    expect(entry.chainSeq).toBe(1);
    expect(entry.prevHash).toBe('0'.repeat(64));
  });

  it('purity is verified and clean after scrubbing', () => {
    const harvest = makeMinimalHarvest();
    harvest.envVars = [{
      name: 'CONTACT',
      file: '.env',
      hasValue: true,
      isTemplate: false,
      inferredPurpose: 'admin@hospital.org',
      isSecret: false,
    }];

    const result = intercept(harvest, CTX);
    expect(result.purityVerified).toBe(true);
  });
});

describe('intercept — uncertain detections', () => {
  it('collects uncertain detections from LOW/UNCERTAIN confidence matches', () => {
    const harvest = makeMinimalHarvest();
    harvest.envVars = [{
      name: 'X',
      file: '.env',
      hasValue: true,
      isTemplate: false,
      inferredPurpose: 'Zip code area: 90210',
      isSecret: false,
    }];

    const result = intercept(harvest, CTX);
    expect(result.purityVerified).toBe(true);
    expect(result.uncertainDetections.length).toBeGreaterThan(0);
    expect(result.uncertainDetections[0]?.confidence).toMatch(/UNCERTAIN|LOW/);
  });
});

import type { HarvestResult } from '@geodesic/types';

/**
 * Minimal HarvestResult fixture for FOCAL/baseline tests. Only fills the
 * fields the new modules (datasource-attestation, data-lineage,
 * drift-detector) actually read; everything else gets zero/empty defaults.
 */
export interface FixtureOverrides {
  engines?: string[];
  schemaFiles?: string[];
  connectionEnvVars?: string[];
  apiRoutes?: HarvestResult['apiRoutes'];
  exposedPorts?: number[];
  hasDockerfile?: boolean;
  importEdges?: HarvestResult['importGraph']['edges'];
  filePaths?: string[];
  envVars?: HarvestResult['envVars'];
}

export function makeHarvest(o: FixtureOverrides = {}): HarvestResult {
  const filePaths = o.filePaths ?? [];
  const fileRecords: HarvestResult['fileRecords'] = {};
  for (const p of filePaths) {
    fileRecords[p] = {
      path: p,
      name: p.split('/').pop() ?? p,
      sizeBytes: 100,
      language: 'TypeScript',
      isSymlink: false,
      extraction: {
        type: 'source',
        exports: [],
        imports: [],
        functions: [],
        classes: [],
        decorators: [],
        hasDefaultExport: false,
      },
    };
  }

  return {
    meta: {
      repoPath: '/tmp/fixture',
      repoName: 'fixture',
      repoCommit: 'abc123',
      harvestedAt: '2025-01-01T00:00:00.000Z',
      harvestDurationMs: 0,
      totalFiles: filePaths.length,
      binaryFiles: 0,
      generatedFiles: 0,
      dataFiles: 0,
      errorFiles: 0,
      symlinkCount: 0,
    },
    monorepoPackages: [],
    languages: { primary: 'TypeScript', all: [] },
    framework: { primary: null, all: [], isMonorepo: false, monoRepoTool: null },
    fileTree: [],
    fileRecords,
    dependencies: [],
    importGraph: {
      edges: o.importEdges ?? [],
      hubFiles: [],
      entryPoints: [],
      leafFiles: [],
      circularCycles: [],
    },
    apiRoutes: o.apiRoutes ?? [],
    databases: {
      engines: o.engines ?? [],
      orm: null,
      migrationsTool: null,
      migrationCount: 0,
      schemaFiles: o.schemaFiles ?? [],
      connectionEnvVars: o.connectionEnvVars ?? [],
    },
    envVars: o.envVars ?? [],
    auth: { patterns: [] },
    cicd: {
      githubActions: [],
      docker: {
        hasDockerfile: o.hasDockerfile ?? false,
        hasCompose: false,
        exposedPorts: o.exposedPorts ?? [],
      },
      kubernetes: false,
      helm: false,
      makefile: { present: false, targets: [] },
      deploymentTargets: [],
    },
    tests: {
      testFileCount: 0,
      frameworks: [],
      coverageToolingPresent: false,
      coverageDirectoryPresent: false,
    },
    piiCandidateLocations: [],
  };
}

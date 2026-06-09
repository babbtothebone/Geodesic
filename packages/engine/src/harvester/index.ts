import type { HarvestResult, PhaseProgressEvent } from '@geodesic/types';
import { walkFileTree, flattenFileTree } from './file-tree.js';
import { readAllFiles } from './file-reader.js';
import { buildRelationships } from './relationship-builder.js';
import { detectLanguages } from './language-detector.js';
import { parseDependencyManifests } from './dependency-parser.js';
import { detectFrameworks } from './framework-detector.js';
import { extractApiRoutes } from './api-route-extractor.js';
import { detectDatabases } from './database-detector.js';
import { collectEnvVars } from './env-var-collector.js';
import { detectAuth } from './auth-detector.js';
import { detectCiCd } from './cicd-detector.js';
import { detectTests } from './test-detector.js';
import { findPiiCandidates } from './pii-candidates.js';
import { extractSchema } from './schema-extractor.js';
import { getHeadCommit, getRepoName } from './git-utils.js';

export function harvest(
  repoPath: string,
  onEvent: (e: PhaseProgressEvent) => void = () => { /* no-op */ },
): HarvestResult {
  const startMs = Date.now();

  // ─── Phase 1: Complete Tree Walk ───────────────────────────────────────────
  onEvent({ type: 'phase_start', phase: 1, message: 'Building file catalog…' });

  const walkResult = walkFileTree(repoPath, onEvent);
  const { fileTree, fileRecords, monorepoPackages } = walkResult;

  const flatFiles = flattenFileTree(fileTree);

  onEvent({
    type: 'phase_complete',
    phase: 1,
    message: `File catalog complete: ${String(walkResult.totalFiles)} files · ${String(walkResult.symlinkCount)} symlinks`,
    count: walkResult.totalFiles,
  });

  // ─── Phase 2: Read Every File ──────────────────────────────────────────────
  onEvent({ type: 'phase_start', phase: 2, message: `Reading ${String(walkResult.totalFiles)} files…` });

  const readCounts = readAllFiles(repoPath, fileRecords, monorepoPackages, onEvent);

  onEvent({
    type: 'phase_complete',
    phase: 2,
    message: [
      `Files read: ${String(Object.keys(fileRecords).length)} total`,
      `${String(readCounts.binaryFiles)} binary`,
      `${String(readCounts.generatedFiles)} generated`,
      `${String(readCounts.dataFiles)} data`,
      `${String(readCounts.errorFiles)} errors`,
    ].join(' · '),
  });

  // ─── Structured Detectors (run on flat file list — precise pattern matching) ──
  const languages = detectLanguages(flatFiles);
  const dependencies = parseDependencyManifests(repoPath, flatFiles);
  const framework = detectFrameworks(dependencies, flatFiles);
  const apiRoutes = extractApiRoutes(repoPath, flatFiles, framework, dependencies);
  const databases = detectDatabases(repoPath, flatFiles, dependencies);
  const envVars = collectEnvVars(repoPath, flatFiles);
  const auth = detectAuth(repoPath, flatFiles, dependencies, apiRoutes);
  const cicd = detectCiCd(repoPath, flatFiles);
  const tests = detectTests(flatFiles, dependencies);
  const piiCandidateLocations = findPiiCandidates(repoPath, flatFiles);
  const harvestedSchema = extractSchema(repoPath, flatFiles);

  if (apiRoutes.length > 0) {
    onEvent({
      type: 'discovery_finding',
      phase: 2,
      message: `Routes: ${String(apiRoutes.length)} endpoints across ${String(new Set(apiRoutes.map(r => r.file)).size)} files`,
    });
  }

  if (databases.orm) {
    onEvent({
      type: 'discovery_finding',
      phase: 2,
      message: `Database: ${databases.orm} · ${String(databases.migrationCount)} migrations · ${String(databases.schemaFiles.length)} schema files`,
    });
  }

  if (auth.patterns.length > 0) {
    onEvent({
      type: 'discovery_finding',
      phase: 2,
      message: `Auth: ${auth.patterns.map(p => p.type).join(' + ')}`,
    });
  }

  if (harvestedSchema.summary.tableCount > 0) {
    onEvent({
      type: 'discovery_finding',
      phase: 2,
      message: `Schema: ${String(harvestedSchema.summary.tableCount)} tables · ${String(harvestedSchema.summary.columnCount)} columns · ${String(harvestedSchema.summary.piiColumnCount)} PII / ${String(harvestedSchema.summary.phiColumnCount)} PHI by name`,
    });
  }

  // ─── Phase 3: Relationship Derivation ─────────────────────────────────────
  onEvent({ type: 'phase_start', phase: 3, message: 'Mapping relationships…' });

  const importGraph = buildRelationships(fileRecords, monorepoPackages, onEvent);

  const totalFiles = walkResult.totalFiles;

  const repoName = getRepoName(repoPath);
  const repoCommit = getHeadCommit(repoPath);

  return {
    meta: {
      repoPath,
      repoName,
      repoCommit,
      harvestedAt: new Date().toISOString(),
      harvestDurationMs: Date.now() - startMs,
      totalFiles,
      binaryFiles: readCounts.binaryFiles,
      generatedFiles: readCounts.generatedFiles,
      dataFiles: readCounts.dataFiles,
      errorFiles: readCounts.errorFiles,
      symlinkCount: walkResult.symlinkCount,
    },
    monorepoPackages,
    languages,
    framework,
    fileTree,
    fileRecords,
    dependencies,
    importGraph,
    apiRoutes,
    databases,
    envVars,
    auth,
    cicd,
    tests,
    piiCandidateLocations,
    harvestedSchema,
  };
}

export type { HarvestResult };

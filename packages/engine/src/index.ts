export { GEODESIC_VERSION } from './version.js';

export { harvest } from './harvester/index.js';
export { intercept, verifyPurity, AttestationChain } from './intercept/index.js';
export type { ScrubContext, PurityResult } from './intercept/index.js';
export { loadProvider, loadEchoProvider, loadConfig, localEmbed, normalizeTo1536 } from './providers/index.js';
export {
  writeArtifacts,
  renderArchitectureMap,
  renderSkillFileJson,
  renderSkillFileMd,
  renderGapReport,
  computeLetterGrade,
  computeDimensionScore,
  computeOverallScore,
} from './artifacts/index.js';
export type { ArtifactPaths } from './artifacts/index.js';
export {
  computeFingerprint,
  normalizeFingerprint,
  queryCrystal,
  CrystalStore,
  getCrystalsDir,
  extractCrystal,
  pullCrystals,
  pushCrystals,
  generateCrystalIndex,
  computeFitnessScore,
  updateCrystalFitness,
} from './crystal/index.js';
export type { ExtractionResult, SyncResult } from './crystal/index.js';
export type { HarvestResult, InterceptResult, SynthesisResult } from '@geodesic/types';
export { synthesize } from './synthesis/index.js';
export type { SynthesisOptions } from './synthesis/index.js';
export { createServer, startPipeline, getJob } from './server/index.js';
export type { AnalysisJob, JobStatus, JobProgress, JobResult } from './server/index.js';

// Chain verification (datasource attestation tamper-check)
export { verifyChainFile, computeRecordHash, canonicalize } from './intercept/chain-writer.js';
export {
  buildDatasourceAttestation,
  writeDatasourceAttestation,
} from './harvester/datasource-attestation.js';
export { buildDataLineage, writeDataLineage, renderDataLineageMermaid } from './artifacts/data-lineage.js';
export {
  loadBaselineFile,
  validateBaseline,
  BaselineLoadError,
  detectDrift,
  writeDriftReport,
  renderDriftReportMd,
} from './baseline/index.js';

// Docs ingest — drop transition documents next to the repo for drift comparison
export {
  TRANSITION_DOCS_DIRNAME,
  getDocsFolderPath,
  getDocsFolderStatus,
  setupDocsFolder,
  collectIngestedDocs,
} from './docs/index.js';
export type { DocsFolderStatus, IngestedDoc, IngestedDocsBundle } from './docs/index.js';

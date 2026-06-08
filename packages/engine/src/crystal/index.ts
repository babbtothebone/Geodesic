export { computeFingerprint, normalizeFingerprint, parseFingerprint } from './fingerprint.js';
export {
  computeFitnessScore,
  computeRecency,
  shouldPromote,
  shouldDeprecate,
  updateCrystalFitness,
} from './fitness.js';
export { queryCrystal, computeFuzzySimilarity, computeSegmentSimilarity } from './query.js';
export { CrystalStore, getCrystalsDir } from './store.js';
export { extractCrystal } from './extractor.js';
export type { ExtractionOptions, ExtractionResult } from './extractor.js';
export { pullCrystals, pushCrystals } from './github-sync.js';
export type { SyncResult } from './github-sync.js';
export { generateCrystalIndex, buildFitnessLogEntry } from './index-writer.js';

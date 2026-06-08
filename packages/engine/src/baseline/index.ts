export { loadBaselineFile, validateBaseline, BaselineLoadError } from './loader.js';
export { detectDrift } from './drift-detector.js';
export type { DriftDetectOpts } from './drift-detector.js';
export { renderDriftReportMd, writeDriftReport } from './drift-writer.js';
export type { WrittenDriftPaths } from './drift-writer.js';

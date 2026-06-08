export type FindingSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export type ScoringDimension =
  | 'Security'
  | 'Compliance'
  | 'Testability'
  | 'Observability'
  | 'Maintainability'
  | 'Documentation'
  | 'Scalability';

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface GapFinding {
  severity: FindingSeverity;
  dimension: ScoringDimension;
  description: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  detail: string;
  fix: string;
  deduction: number;
}

export interface DimensionScore {
  dimension: ScoringDimension;
  score: number;
  grade: LetterGrade;
  active: boolean;
  findings: GapFinding[];
}

export interface UncertainDetectionReport {
  entryId: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  isApproximateRange: boolean;
  trigger: string;
  confidencePct: number;
  confidence: 'UNCERTAIN' | 'LOW';
  attestationRef: string;
  action: string;
  markedReviewed: boolean;
}

export interface GapReport {
  repoName: string;
  analyzedAt: string;
  overallScore: number;
  overallGrade: LetterGrade;
  dimensions: DimensionScore[];
  uncertainDetections: UncertainDetectionReport[];
  recommendedPathForward: string;
}

export interface SkillFileMeta {
  geodeVersion: string;
  schemaVersion: string;
  analyzedAt: string;
  analystId: string;
  repo: string;
  repoCommit: string;
  crystalId: string | null;
  crystalMatchScore: number | null;
  analysisDurationMs: number;
  provider: string;
  model: string;
}

export interface SkillFileStack {
  primaryLanguage: string;
  allLanguages: string[];
  runtime: string | null;
  framework: string | null;
  secondaryFrameworks: string[];
  orm: string | null;
  authStrategy: string | null;
  emailProvider: string | null;
  paymentProvider: string | null;
  deployment: string | null;
  isMonorepo: boolean;
  monoRepoTool: string | null;
}

export interface SkillFileEntryPoint {
  file: string;
  type: string;
  description: string;
}

export interface SkillFileLayer {
  name: string;
  path: string;
  responsibility: string;
  keyFiles: string[];
}

export interface SkillFileModule {
  name: string;
  path: string;
  purpose: string;
  importedByCount: number;
}

export interface CircularDependency {
  files: string[];
  description: string;
}

export interface SkillFileTopology {
  entryPoints: SkillFileEntryPoint[];
  layers: SkillFileLayer[];
  keyModules: SkillFileModule[];
  circularDependencies: CircularDependency[];
}

export interface SkillFileApiRoute {
  method: string;
  path: string;
  file: string;
  line: number;
  authRequired: boolean;
  authMethod: string | null;
  phiAdjacent: boolean;
}

export interface SkillFileExternalService {
  service: string;
  baseUrlPattern: string;
  authMethod: string;
  filesReferencing: string[];
}

export interface SkillFileWebhook {
  path: string;
  provider: string;
  file: string;
  line: number;
  verified: boolean;
}

export interface SkillFileApis {
  internal: SkillFileApiRoute[];
  external: SkillFileExternalService[];
  webhooks: SkillFileWebhook[];
}

export interface SkillFileDatabases {
  engines: string[];
  orm: string | null;
  migrationsTool: string | null;
  migrationCount: number;
  schemaFiles: string[];
  connectionEnvVars: string[];
  phiTablesDetected: boolean;
}

export interface SkillFileRequiredEnvVar {
  name: string;
  purpose: string;
  isSecret: boolean;
}

export interface SkillFileOptionalEnvVar {
  name: string;
  purpose: string;
  defaultDescribed: string | null;
}

export interface SkillFileEnvVars {
  required: SkillFileRequiredEnvVar[];
  optional: SkillFileOptionalEnvVar[];
  missingFromExample: string[];
}

export interface SkillFilePatterns {
  authFlow: string;
  errorHandling: string;
  testingApproach: string;
  logging: string;
  apiVersioning: string | null;
  rateLimiting: string | null;
}

export interface PhiZone {
  file: string;
  lineStart: number;
  lineEnd: number;
  phiFieldCount: number;
  hipaaCategories: string[];
  attestationRefs: string[];
  protectionPresent: string[];
  protectionMissing: string[];
  devNote: string;
}

export interface SkillFileDevHooks {
  addApiRoute: string;
  addDbModel: string;
  addMigration: string;
  addTest: string;
  addMiddleware: string;
  addEnvVar: string;
}

export interface SkillFileConstraints {
  knownQuirks: string[];
  breakingChangeRisks: string[];
  techDebtHotspots: string[];
}

export interface SkillFileInfra {
  containerized: boolean;
  orchestration: string | null;
  ciCdTools: string[];
  deploymentTargets: string[];
  hasHealthCheck: boolean;
  hasMonitoring: boolean;
}

export interface SkillFileJson {
  $schema: string;
  meta: SkillFileMeta;
  stack: SkillFileStack;
  topology: SkillFileTopology;
  apis: SkillFileApis;
  databases: SkillFileDatabases;
  envVars: SkillFileEnvVars;
  patterns: SkillFilePatterns;
  phiZones: PhiZone[];
  devHooks: SkillFileDevHooks;
  constraints: SkillFileConstraints;
  infra: SkillFileInfra;
}

export interface SynthesisResult {
  skillFile: SkillFileJson;
  gapReport: GapReport;
  architectureMapMarkdown: string;
  synthesisTokensUsed: number;
  echoHintsApplied: number;
  crystalId: string | null;
}

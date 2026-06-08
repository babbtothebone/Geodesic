export interface HarvestMeta {
  repoPath: string;
  repoName: string;
  repoCommit: string | null;
  harvestedAt: string;
  harvestDurationMs: number;
  totalFiles: number;
  binaryFiles: number;
  generatedFiles: number;
  dataFiles: number;
  errorFiles: number;
  symlinkCount: number;
}

export interface LanguageCount {
  language: string;
  fileCount: number;
}

export interface LanguageInventory {
  primary: string;
  all: LanguageCount[];
}

export interface FrameworkInventory {
  primary: string | null;
  all: string[];
  isMonorepo: boolean;
  monoRepoTool: string | null;
}

// ─── File Tree (hierarchical display) ─────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  language: string | null;
  sizeBytes: number | null;
  children: FileTreeNode[];
  isKeyDirectory: boolean;
  keyDirectoryType: string | null;
}

// ─── File Records (analysis catalog) ──────────────────────────────────────────

export type FileExtraction =
  | {
      type: 'source';
      exports: string[];
      imports: string[];
      functions: string[];
      classes: string[];
      decorators: string[];
      hasDefaultExport: boolean;
    }
  | { type: 'config'; content: string }
  | { type: 'schema'; content: string }
  | { type: 'env'; keys: string[]; hasRealValues: boolean }
  | { type: 'lockfile'; dependencyCount: number; lockfileFormat: string }
  | { type: 'docs'; content: string }
  | { type: 'script'; content: string }
  | { type: 'binary'; detectedFormat: string }
  | { type: 'generated'; generator: string | null; sourceSpec: string | null }
  | { type: 'data'; detectedFormat: string; characterization: string }
  | { type: 'error'; message: string; code: string | null }
  | { type: 'unknown' };

export interface FileRecord {
  path: string;
  name: string;
  sizeBytes: number;
  language: string | null;
  isSymlink: boolean;
  extraction: FileExtraction;
}

// ─── Monorepo ─────────────────────────────────────────────────────────────────

export interface MonorepoPackage {
  name: string;
  path: string;
  manifestPath: string;
}

// ─── Import Graph ─────────────────────────────────────────────────────────────

export interface ImportEdge {
  from: string;
  to: string;
  isExternal: boolean;
  isCrossPackage: boolean;
  rawImport: string;
}

export interface CircularDepCycle {
  cycle: string[];
}

export interface ImportGraph {
  edges: ImportEdge[];
  hubFiles: string[];
  entryPoints: string[];
  leafFiles: string[];
  circularCycles: CircularDepCycle[];
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface DependencyEntry {
  name: string;
  version: string;
  isDev: boolean;
}

export type ManifestType =
  | 'package.json'
  | 'requirements.txt'
  | 'go.mod'
  | 'Cargo.toml'
  | 'pom.xml'
  | 'build.gradle'
  | 'composer.json'
  | 'Gemfile'
  | 'pyproject.toml';

export interface DependencyManifest {
  file: string;
  type: ManifestType;
  name: string | null;
  version: string | null;
  dependencies: DependencyEntry[];
  scripts: Record<string, string>;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';

export interface ApiRoute {
  method: HttpMethod;
  path: string;
  file: string;
  line: number;
  authRequired: boolean;
  authMethod: string | null;
  middlewareChain: string[];
}

// ─── Database ─────────────────────────────────────────────────────────────────

export interface DatabaseInventory {
  engines: string[];
  orm: string | null;
  migrationsTool: string | null;
  migrationCount: number;
  schemaFiles: string[];
  connectionEnvVars: string[];
}

// ─── Environment Variables ────────────────────────────────────────────────────

export interface EnvVarEntry {
  name: string;
  file: string;
  hasValue: boolean;
  isTemplate: boolean;
  inferredPurpose: string | null;
  isSecret: boolean;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type AuthPatternType = 'jwt' | 'session' | 'oauth' | 'apikey' | 'magic_link' | 'unknown';

export interface AuthPattern {
  type: AuthPatternType;
  keyFiles: string[];
  coversAllRoutes: boolean;
}

export interface AuthInventory {
  patterns: AuthPattern[];
}

// ─── CI/CD ────────────────────────────────────────────────────────────────────

export interface GithubActionsWorkflow {
  name: string;
  file: string;
  triggers: string[];
  jobs: string[];
}

export interface DockerInventory {
  hasDockerfile: boolean;
  hasCompose: boolean;
  exposedPorts: number[];
}

export interface MakefileInventory {
  present: boolean;
  targets: string[];
}

export interface CiCdInventory {
  githubActions: GithubActionsWorkflow[];
  docker: DockerInventory;
  kubernetes: boolean;
  helm: boolean;
  makefile: MakefileInventory;
  deploymentTargets: string[];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

export interface TestInventory {
  testFileCount: number;
  frameworks: string[];
  coverageToolingPresent: boolean;
  coverageDirectoryPresent: boolean;
}

// ─── PII Candidates ───────────────────────────────────────────────────────────

export interface PiiCandidateLocation {
  file: string;
  lineStart: number;
  lineEnd: number;
  hint: string;
}

// ─── Harvest Result ───────────────────────────────────────────────────────────

export interface HarvestResult {
  meta: HarvestMeta;
  monorepoPackages: MonorepoPackage[];
  languages: LanguageInventory;
  framework: FrameworkInventory;
  fileTree: FileTreeNode[];
  fileRecords: Record<string, FileRecord>;
  dependencies: DependencyManifest[];
  importGraph: ImportGraph;
  apiRoutes: ApiRoute[];
  databases: DatabaseInventory;
  envVars: EnvVarEntry[];
  auth: AuthInventory;
  cicd: CiCdInventory;
  tests: TestInventory;
  piiCandidateLocations: PiiCandidateLocation[];
}

import * as fs from 'fs';
import * as path from 'path';
import type { FileTreeNode, FileRecord, MonorepoPackage, PhaseProgressEvent } from '@geodesic/types';

export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.venv', 'venv', 'env', 'target', 'vendor',
  '.next', '.nuxt', '.turbo', '.svelte-kit', '.output',
  'coverage', '.nyc_output', 'out', '.cache',
]);

const KEPT_DOT_DIRS = new Set(['.github', '.gitlab']);

export const LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML',
  '.sql': 'SQL',
  '.md': 'Markdown',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
  '.sh': 'Shell', '.bash': 'Shell',
  '.tf': 'HCL', '.hcl': 'HCL',
  '.graphql': 'GraphQL', '.gql': 'GraphQL',
  '.proto': 'Protobuf',
  '.prisma': 'Prisma',
  '.xml': 'XML',
  '.csv': 'CSV',
};

const KEY_DIRECTORY_MAP: Record<string, string> = {
  src: 'source_root', app: 'source_root', lib: 'source_root',
  pkg: 'source_root', internal: 'source_root',
  tests: 'tests', __tests__: 'tests', spec: 'tests', test: 'tests',
  migrations: 'migrations', '__mocks__': 'mocks',
  '.github': 'ci', '.gitlab': 'ci',
  docs: 'docs', documentation: 'docs',
  public: 'static_assets', static: 'static_assets', assets: 'static_assets',
  scripts: 'scripts', bin: 'scripts',
  infra: 'infrastructure', infrastructure: 'infrastructure',
  deploy: 'infrastructure', helm: 'infrastructure',
  k8s: 'infrastructure', kubernetes: 'infrastructure',
  config: 'config', configs: 'config',
  prisma: 'database', db: 'database', database: 'database',
  generated: 'generated', __generated__: 'generated', codegen: 'generated',
};

const MONOREPO_MANIFEST_NAMES = new Set([
  'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
]);

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export interface TreeWalkResult {
  fileTree: FileTreeNode[];
  fileRecords: Record<string, FileRecord>;
  monorepoPackages: MonorepoPackage[];
  totalFiles: number;
  symlinkCount: number;
}

export function walkFileTree(
  repoPath: string,
  onEvent: (e: PhaseProgressEvent) => void,
): TreeWalkResult {
  const fileRecords: Record<string, FileRecord> = {};
  const monorepoPackages: MonorepoPackage[] = [];
  let totalFiles = 0;
  let symlinkCount = 0;

  const fileTree = walkDirectory(
    repoPath, repoPath, fileRecords, monorepoPackages,
    { totalFiles: 0, symlinkCount: 0 }, onEvent,
  );

  for (const r of Object.values(fileRecords)) {
    if (r.isSymlink) symlinkCount++;
    else totalFiles++;
  }

  return { fileTree, fileRecords, monorepoPackages, totalFiles, symlinkCount };
}

function walkDirectory(
  basePath: string,
  currentPath: string,
  fileRecords: Record<string, FileRecord>,
  monorepoPackages: MonorepoPackage[],
  counters: { totalFiles: number; symlinkCount: number },
  onEvent: (e: PhaseProgressEvent) => void,
): FileTreeNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    const relativePath = normalizePath(path.relative(basePath, fullPath));

    if (entry.isSymbolicLink()) {
      counters.symlinkCount++;
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'symlink',
        language: null,
        sizeBytes: null,
        children: [],
        isKeyDirectory: false,
        keyDirectoryType: null,
      });
      fileRecords[relativePath] = {
        path: relativePath,
        name: entry.name,
        sizeBytes: 0,
        language: null,
        isSymlink: true,
        extraction: { type: 'unknown' },
      };
      onEvent({ type: 'file_cataloged', phase: 1, message: `symlink: ${relativePath}`, filePath: relativePath });
      continue;
    }

    if (entry.isDirectory()) {
      const isDotDir = entry.name.startsWith('.');
      if (EXCLUDED_DIRS.has(entry.name) || (isDotDir && !KEPT_DOT_DIRS.has(entry.name))) {
        continue;
      }
      const children = walkDirectory(basePath, fullPath, fileRecords, monorepoPackages, counters, onEvent);
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        language: null,
        sizeBytes: null,
        children,
        isKeyDirectory: entry.name in KEY_DIRECTORY_MAP,
        keyDirectoryType: KEY_DIRECTORY_MAP[entry.name] ?? null,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(fullPath).size;
      } catch { /* non-fatal */ }

      const language = LANGUAGE_EXTENSION_MAP[ext] ?? null;
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        language,
        sizeBytes,
        children: [],
        isKeyDirectory: false,
        keyDirectoryType: null,
      });

      // Stub record — Phase 2 fills in the extraction
      fileRecords[relativePath] = {
        path: relativePath,
        name: entry.name,
        sizeBytes,
        language,
        isSymlink: false,
        extraction: { type: 'unknown' },
      };

      // Detect monorepo package manifests
      if (MONOREPO_MANIFEST_NAMES.has(entry.name)) {
        const dirRel = normalizePath(path.relative(basePath, currentPath));
        if (dirRel !== '' && !monorepoPackages.some(p => p.manifestPath === relativePath)) {
          monorepoPackages.push({ name: '', path: dirRel, manifestPath: relativePath });
        }
      }

      counters.totalFiles++;
      onEvent({
        type: 'file_cataloged',
        phase: 1,
        message: relativePath,
        filePath: relativePath,
        count: counters.totalFiles,
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'directory') return -1;
      if (b.type === 'directory') return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenFileTree(node.children));
    }
  }
  return result;
}

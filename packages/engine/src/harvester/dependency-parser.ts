import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { parse as parseToml } from 'smol-toml';
import { XMLParser } from 'fast-xml-parser';
import type { DependencyEntry, DependencyManifest, FileTreeNode, ManifestType } from '@geodesic/types';

const MANIFEST_FILENAMES = new Set([
  'package.json', 'requirements.txt', 'go.mod',
  'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'composer.json', 'Gemfile', 'pyproject.toml',
]);

export function parseDependencyManifests(
  repoPath: string,
  files: FileTreeNode[],
): DependencyManifest[] {
  const manifests: DependencyManifest[] = [];
  const manifestFiles = files.filter(
    f => f.type === 'file' && MANIFEST_FILENAMES.has(f.name),
  );

  for (const file of manifestFiles) {
    const fullPath = path.join(repoPath, file.path);
    const manifest = parseManifest(fullPath, file.path, file.name);
    if (manifest !== null) manifests.push(manifest);
  }

  return manifests;
}

function parseManifest(
  fullPath: string,
  relativePath: string,
  filename: string,
): DependencyManifest | null {
  let content: string;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }

  switch (filename) {
    case 'package.json': return parsePackageJson(relativePath, content);
    case 'requirements.txt': return parseRequirementsTxt(relativePath, content);
    case 'go.mod': return parseGoMod(relativePath, content);
    case 'Cargo.toml': return parseCargo(relativePath, content);
    case 'pom.xml': return parsePomXml(relativePath, content);
    case 'build.gradle':
    case 'build.gradle.kts': return parseBuildGradle(relativePath, content);
    case 'composer.json': return parseComposerJson(relativePath, content);
    case 'Gemfile': return parseGemfile(relativePath, content);
    case 'pyproject.toml': return parsePyprojectToml(relativePath, content);
    default: return null;
  }
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, string>;
  }
  return {};
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parsePackageJson(file: string, content: string): DependencyManifest | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const deps: DependencyEntry[] = [];
  for (const [name, version] of Object.entries(asStringRecord(parsed['dependencies']))) {
    deps.push({ name, version, isDev: false });
  }
  for (const [name, version] of Object.entries(asStringRecord(parsed['devDependencies']))) {
    deps.push({ name, version, isDev: true });
  }

  const scripts: Record<string, string> = {};
  for (const [k, v] of Object.entries(asStringRecord(parsed['scripts']))) {
    scripts[k] = v;
  }

  return {
    file,
    type: 'package.json' as ManifestType,
    name: typeof parsed['name'] === 'string' ? parsed['name'] : null,
    version: typeof parsed['version'] === 'string' ? parsed['version'] : null,
    dependencies: deps,
    scripts,
  };
}

function parseRequirementsTxt(file: string, content: string): DependencyManifest {
  const deps: DependencyEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const match = /^([A-Za-z0-9._-]+)\s*([><=!~^].+)?/.exec(trimmed);
    if (match?.[1]) {
      deps.push({ name: match[1].toLowerCase(), version: match[2]?.trim() ?? '*', isDev: false });
    }
  }
  return { file, type: 'requirements.txt', name: null, version: null, dependencies: deps, scripts: {} };
}

function parseGoMod(file: string, content: string): DependencyManifest {
  const deps: DependencyEntry[] = [];
  let moduleName: string | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const moduleMatch = /^module\s+(\S+)/.exec(trimmed);
    if (moduleMatch?.[1]) { moduleName = moduleMatch[1]; continue; }

    const requireMatch = /^\s*([^\s]+)\s+(v[^\s]+)/.exec(trimmed);
    if (requireMatch?.[1] && requireMatch[2]) {
      deps.push({ name: requireMatch[1], version: requireMatch[2], isDev: false });
    }
  }
  return { file, type: 'go.mod', name: moduleName, version: null, dependencies: deps, scripts: {} };
}

function parseCargo(file: string, content: string): DependencyManifest | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(content);
  } catch {
    return null;
  }

  const pkg = parsed['package'] as Record<string, unknown> | undefined;
  const deps: DependencyEntry[] = [];

  function extractDeps(section: unknown, isDev: boolean): void {
    if (typeof section !== 'object' || section === null) return;
    for (const [name, val] of Object.entries(section as Record<string, unknown>)) {
      const version = typeof val === 'string' ? val : (asStringRecord(val))['version'] ?? '*';
      deps.push({ name, version, isDev });
    }
  }

  extractDeps(parsed['dependencies'], false);
  extractDeps(parsed['dev-dependencies'], true);

  return {
    file,
    type: 'Cargo.toml',
    name: typeof pkg?.['name'] === 'string' ? pkg['name'] : null,
    version: typeof pkg?.['version'] === 'string' ? pkg['version'] : null,
    dependencies: deps,
    scripts: {},
  };
}

function parsePomXml(file: string, content: string): DependencyManifest | null {
  const parser = new XMLParser({ ignoreAttributes: false });
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const project = parsed['project'] as Record<string, unknown> | undefined;
  if (!project) return null;

  const deps: DependencyEntry[] = [];
  const depsSection = project['dependencies'] as Record<string, unknown> | undefined;
  const depList = depsSection?.['dependency'];

  const rawList = Array.isArray(depList) ? depList : depList ? [depList] : [];
  for (const dep of rawList as Record<string, string>[]) {
    const artifactId = dep['artifactId'] ?? '';
    const groupId = dep['groupId'] ?? '';
    const version = dep['version'] ?? '*';
    const scope = dep['scope'] ?? 'compile';
    deps.push({
      name: `${groupId}:${artifactId}`,
      version,
      isDev: scope === 'test',
    });
  }

  return {
    file,
    type: 'pom.xml',
    name: typeof project['artifactId'] === 'string' ? project['artifactId'] : null,
    version: typeof project['version'] === 'string' ? project['version'] : null,
    dependencies: deps,
    scripts: {},
  };
}

function parseBuildGradle(file: string, content: string): DependencyManifest {
  const deps: DependencyEntry[] = [];
  const pattern = /(?:implementation|testImplementation|api|compileOnly|runtimeOnly)\s*\(?['"]([^'"]+)['"]\)?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const coord = match[1] ?? '';
    const parts = coord.split(':');
    const name = parts.slice(0, 2).join(':');
    const version = parts[2] ?? '*';
    const isDev = match[0].startsWith('test');
    deps.push({ name, version, isDev });
  }
  return { file, type: 'build.gradle', name: null, version: null, dependencies: deps, scripts: {} };
}

function parseComposerJson(file: string, content: string): DependencyManifest | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const deps: DependencyEntry[] = [];
  for (const [name, version] of Object.entries(asStringRecord(parsed['require']))) {
    deps.push({ name, version, isDev: false });
  }
  for (const [name, version] of Object.entries(asStringRecord(parsed['require-dev']))) {
    deps.push({ name, version, isDev: true });
  }

  return {
    file,
    type: 'composer.json',
    name: typeof parsed['name'] === 'string' ? parsed['name'] : null,
    version: typeof parsed['version'] === 'string' ? parsed['version'] : null,
    dependencies: deps,
    scripts: {},
  };
}

function parseGemfile(file: string, content: string): DependencyManifest {
  const deps: DependencyEntry[] = [];
  const pattern = /^gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    deps.push({
      name: match[1] ?? '',
      version: match[2] ?? '*',
      isDev: false,
    });
  }
  return { file, type: 'Gemfile', name: null, version: null, dependencies: deps, scripts: {} };
}

function parsePyprojectToml(file: string, content: string): DependencyManifest | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(content);
  } catch {
    return null;
  }

  const deps: DependencyEntry[] = [];
  const project = parsed['project'] as Record<string, unknown> | undefined;
  const poetry = asUnknownRecord(asUnknownRecord(parsed['tool'])['poetry']);

  function extractPyDeps(list: unknown, isDev: boolean): void {
    if (!Array.isArray(list)) return;
    for (const item of list as string[]) {
      const match = /^([A-Za-z0-9._-]+)/.exec(item);
      if (match?.[1]) deps.push({ name: match[1].toLowerCase(), version: item.slice(match[1].length).trim() || '*', isDev });
    }
  }

  extractPyDeps(project?.['dependencies'], false);
  extractPyDeps(project?.['optional-dependencies'], false);

  const poetryDeps = asUnknownRecord(poetry['dependencies']);
  for (const [name, val] of Object.entries(poetryDeps)) {
    if (name === 'python') continue;
    deps.push({ name: name.toLowerCase(), version: String(val), isDev: false });
  }
  const poetryDevDeps = asUnknownRecord(poetry['dev-dependencies']);
  for (const [name, val] of Object.entries(poetryDevDeps)) {
    deps.push({ name: name.toLowerCase(), version: String(val), isDev: true });
  }

  const name =
    typeof project?.['name'] === 'string' ? project['name'] :
    typeof poetry['name'] === 'string' ? poetry['name'] : null;
  const version =
    typeof project?.['version'] === 'string' ? project['version'] :
    typeof poetry['version'] === 'string' ? poetry['version'] : null;

  return { file, type: 'pyproject.toml', name, version, dependencies: deps, scripts: {} };
}

// Re-export yaml so other modules don't need to import it
export { yaml };

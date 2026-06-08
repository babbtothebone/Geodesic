import * as path from 'path';
import type {
  FileRecord,
  ImportEdge,
  ImportGraph,
  CircularDepCycle,
  MonorepoPackage,
  PhaseProgressEvent,
} from '@geodesic/types';
import { normalizePath } from './file-tree.js';

const HUB_FILE_IMPORT_THRESHOLD = 5;

// ─── Import Resolution ────────────────────────────────────────────────────────

function resolveImport(
  fromPath: string,
  rawImport: string,
  monorepoPackages: MonorepoPackage[],
  allPaths: Set<string>,
): { to: string; isExternal: boolean; isCrossPackage: boolean } | null {
  // Cross-package monorepo import
  const crossPkg = monorepoPackages.find(p => p.name && rawImport === p.name || rawImport.startsWith(p.name + '/'));
  if (crossPkg) {
    const subPath = rawImport.slice(crossPkg.name.length).replace(/^\//, '');
    const base = crossPkg.path + (subPath ? '/' + subPath : '');
    const resolved = tryResolveRelative(base, allPaths);
    return { to: resolved ?? base, isExternal: false, isCrossPackage: true };
  }

  // External package (no dot prefix, no tilde)
  if (!rawImport.startsWith('.') && !rawImport.startsWith('/') && !rawImport.startsWith('~')) {
    return { to: rawImport, isExternal: true, isCrossPackage: false };
  }

  // Relative import
  const fromDir = normalizePath(path.dirname(fromPath));
  const joined = normalizePath(path.posix.join(fromDir, rawImport));
  const resolved = tryResolveRelative(joined, allPaths);
  if (!resolved) return null;
  return { to: resolved, isExternal: false, isCrossPackage: false };
}

function tryResolveRelative(base: string, allPaths: Set<string>): string | null {
  // Try exact match first
  if (allPaths.has(base)) return base;

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.rs'];
  for (const ext of extensions) {
    if (allPaths.has(base + ext)) return base + ext;
  }

  // Try index files
  const indexVariants = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/mod.ts', '/__init__.py'];
  for (const variant of indexVariants) {
    if (allPaths.has(base + variant)) return base + variant;
  }

  return null;
}

// ─── Circular Dependency Detection ───────────────────────────────────────────

type DFSColor = 'white' | 'gray' | 'black';

function detectCycles(
  adjacency: Map<string, string[]>,
  internalPaths: Set<string>,
): CircularDepCycle[] {
  const color = new Map<string, DFSColor>();
  const parent = new Map<string, string>();
  const cycles: CircularDepCycle[] = [];
  const seenCycles = new Set<string>();

  for (const node of internalPaths) {
    color.set(node, 'white');
  }

  function dfs(node: string, stack: string[]): void {
    color.set(node, 'gray');
    stack.push(node);

    for (const neighbor of (adjacency.get(node) ?? [])) {
      if (!internalPaths.has(neighbor)) continue;

      const neighborColor = color.get(neighbor);
      if (neighborColor === 'gray') {
        // Found a cycle — extract it from the stack
        const cycleStart = stack.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = [...stack.slice(cycleStart), neighbor];
          const key = [...cycle].sort().join('|');
          if (!seenCycles.has(key)) {
            seenCycles.add(key);
            cycles.push({ cycle });
          }
        }
      } else if (neighborColor === 'white') {
        parent.set(neighbor, node);
        dfs(neighbor, stack);
      }
    }

    stack.pop();
    color.set(node, 'black');
  }

  for (const node of internalPaths) {
    if (color.get(node) === 'white') {
      dfs(node, []);
    }
  }

  return cycles;
}

// ─── Main Relationship Builder ────────────────────────────────────────────────

export function buildRelationships(
  fileRecords: Record<string, FileRecord>,
  monorepoPackages: MonorepoPackage[],
  onEvent: (e: PhaseProgressEvent) => void,
): ImportGraph {
  const allPaths = new Set(Object.keys(fileRecords));
  const edges: ImportEdge[] = [];

  // importedBy count per internal file
  const importedByCount = new Map<string, number>();
  // adjacency list for cycle detection (internal imports only)
  const adjacency = new Map<string, string[]>();
  // files that import at least one internal file
  const filesWithInternalImports = new Set<string>();

  let edgeCount = 0;

  for (const [fromPath, record] of Object.entries(fileRecords)) {
    if (record.isSymlink) continue;
    if (record.extraction.type !== 'source') continue;

    const rawImports = record.extraction.imports;
    if (rawImports.length === 0) continue;

    const adjList: string[] = [];

    for (const rawImport of rawImports) {
      const resolved = resolveImport(fromPath, rawImport, monorepoPackages, allPaths);
      if (!resolved) continue;

      edges.push({
        from: fromPath,
        to: resolved.to,
        isExternal: resolved.isExternal,
        isCrossPackage: resolved.isCrossPackage,
        rawImport,
      });

      edgeCount++;

      if (!resolved.isExternal) {
        filesWithInternalImports.add(fromPath);
        importedByCount.set(resolved.to, (importedByCount.get(resolved.to) ?? 0) + 1);
        adjList.push(resolved.to);
      }
    }

    if (adjList.length > 0) {
      adjacency.set(fromPath, adjList);
    }
  }

  onEvent({
    type: 'relationship_found',
    phase: 3,
    message: `Import graph: ${String(edgeCount)} edges`,
    count: edgeCount,
  });

  // Hub files: imported by 5+ internal files
  const hubFiles: string[] = [];
  for (const [filePath, count] of importedByCount.entries()) {
    if (count >= HUB_FILE_IMPORT_THRESHOLD) {
      hubFiles.push(filePath);
      onEvent({
        type: 'discovery_finding',
        phase: 3,
        message: `Hub file: ${filePath} (imported by ${String(count)} files)`,
        filePath,
      });
    }
  }

  // Entry points: files that are NOT imported by any other internal file
  const entryPoints: string[] = [];
  for (const filePath of Object.keys(fileRecords)) {
    const record = fileRecords[filePath];
    if (!record || record.isSymlink || record.extraction.type !== 'source') continue;
    if (!importedByCount.has(filePath) || importedByCount.get(filePath) === 0) {
      // Only flag as entry point if the file itself has some exports or structure
      if (record.extraction.exports.length > 0 || record.extraction.hasDefaultExport) {
        entryPoints.push(filePath);
      }
    }
  }

  // Leaf files: source files that import nothing internal
  const leafFiles: string[] = [];
  for (const filePath of Object.keys(fileRecords)) {
    const record = fileRecords[filePath];
    if (!record || record.isSymlink || record.extraction.type !== 'source') continue;
    if (!filesWithInternalImports.has(filePath)) {
      leafFiles.push(filePath);
    }
  }

  // Circular dependency detection
  const internalPaths = new Set(
    Object.keys(fileRecords).filter(p => {
      const r = fileRecords[p];
      return r && !r.isSymlink && r.extraction.type === 'source';
    }),
  );

  const circularCycles = detectCycles(adjacency, internalPaths);

  if (circularCycles.length > 0) {
    onEvent({
      type: 'discovery_finding',
      phase: 3,
      message: `${String(circularCycles.length)} circular dependenc${circularCycles.length === 1 ? 'y' : 'ies'} detected`,
      count: circularCycles.length,
    });
  }

  // Mark hub files in file records (for progress display during Phase 2 retroactively noted here)
  for (const hubFile of hubFiles) {
    const count = importedByCount.get(hubFile) ?? 0;
    onEvent({
      type: 'discovery_finding',
      phase: 3,
      message: `Hub: ${hubFile} (${String(count)} importers)`,
      filePath: hubFile,
    });
  }

  onEvent({
    type: 'phase_complete',
    phase: 3,
    message: `Relationships mapped: ${String(edgeCount)} import edges · ${String(circularCycles.length)} cycles · ${String(hubFiles.length)} hubs · ${String(entryPoints.length)} entry points`,
  });

  return {
    edges,
    hubFiles,
    entryPoints,
    leafFiles,
    circularCycles,
  };
}

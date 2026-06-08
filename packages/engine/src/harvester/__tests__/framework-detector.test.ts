import { describe, expect, it } from 'vitest';
import { detectFrameworks } from '../framework-detector.js';
import type { DependencyManifest, FileTreeNode } from '@geodesic/types';

function makeManifest(deps: string[]): DependencyManifest {
  return {
    file: 'package.json',
    type: 'package.json',
    name: null,
    version: null,
    dependencies: deps.map(name => ({ name, version: '*', isDev: false })),
    scripts: {},
  };
}

function makeFile(name: string, filePath: string): FileTreeNode {
  return {
    name,
    path: filePath,
    type: 'file',
    language: null,
    sizeBytes: 100,
    children: [],
    isKeyDirectory: false,
    keyDirectoryType: null,
  };
}

describe('detectFrameworks', () => {
  it('detects Next.js from package.json dep', () => {
    const result = detectFrameworks([makeManifest(['next', 'react'])], []);
    expect(result.primary).toBe('Next.js');
    expect(result.all).toContain('Next.js');
  });

  it('detects FastAPI from Python requirements', () => {
    const manifest: DependencyManifest = {
      file: 'requirements.txt',
      type: 'requirements.txt',
      name: null,
      version: null,
      dependencies: [{ name: 'fastapi', version: '*', isDev: false }],
      scripts: {},
    };
    const result = detectFrameworks([manifest], []);
    expect(result.all).toContain('FastAPI');
  });

  it('detects monorepo from turbo.json', () => {
    const files: FileTreeNode[] = [makeFile('turbo.json', 'turbo.json')];
    const result = detectFrameworks([], files);
    expect(result.isMonorepo).toBe(true);
    expect(result.monoRepoTool).toBe('Turborepo');
  });

  it('detects monorepo from multiple package.json files', () => {
    const manifests: DependencyManifest[] = [
      makeManifest([]),
      makeManifest([]),
      makeManifest([]),
    ];
    const result = detectFrameworks(manifests, []);
    expect(result.isMonorepo).toBe(true);
  });

  it('returns null primary and empty all for no frameworks', () => {
    const result = detectFrameworks([makeManifest(['lodash'])], []);
    expect(result.primary).toBeNull();
    expect(result.all).toHaveLength(0);
  });
});

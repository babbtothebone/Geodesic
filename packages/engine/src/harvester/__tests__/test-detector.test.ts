import { describe, expect, it } from 'vitest';
import { detectTests } from '../test-detector.js';
import type { DependencyManifest, FileTreeNode } from '@geodesic/types';

function makeFile(name: string, filePath: string): FileTreeNode {
  return {
    name,
    path: filePath,
    type: 'file',
    language: null,
    sizeBytes: null,
    children: [],
    isKeyDirectory: false,
    keyDirectoryType: null,
  };
}

function makeManifest(deps: string[], scripts: Record<string, string> = {}): DependencyManifest {
  return {
    file: 'package.json',
    type: 'package.json',
    name: null,
    version: null,
    dependencies: deps.map(name => ({ name, version: '*', isDev: true })),
    scripts,
  };
}

describe('detectTests', () => {
  it('counts .test.ts files', () => {
    const files: FileTreeNode[] = [
      makeFile('foo.test.ts', 'src/foo.test.ts'),
      makeFile('bar.test.ts', 'src/bar.test.ts'),
      makeFile('index.ts', 'src/index.ts'),
    ];
    const result = detectTests(files, []);
    expect(result.testFileCount).toBe(2);
  });

  it('counts _spec.rb files', () => {
    const files: FileTreeNode[] = [
      makeFile('user_spec.rb', 'spec/user_spec.rb'),
      makeFile('user.rb', 'app/user.rb'),
    ];
    const result = detectTests(files, []);
    expect(result.testFileCount).toBe(1);
    expect(result.frameworks).toContain('RSpec');
  });

  it('detects Vitest from deps', () => {
    const result = detectTests([], [makeManifest(['vitest'])]);
    expect(result.frameworks).toContain('Vitest');
  });

  it('detects coverage tooling from --coverage script', () => {
    const result = detectTests(
      [],
      [makeManifest([], { test: 'vitest run --coverage' })],
    );
    expect(result.coverageToolingPresent).toBe(true);
  });

  it('detects coverage directory', () => {
    const files: FileTreeNode[] = [
      { name: 'coverage', path: 'coverage', type: 'directory', language: null, sizeBytes: null, children: [], isKeyDirectory: false, keyDirectoryType: null },
    ];
    const result = detectTests(files, []);
    expect(result.coverageDirectoryPresent).toBe(true);
  });
});

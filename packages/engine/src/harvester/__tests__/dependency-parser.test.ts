import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseDependencyManifests } from '../dependency-parser.js';
import type { FileTreeNode } from '@geodesic/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-test-'));
}

function makeFileNode(name: string, filePath: string): FileTreeNode {
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

describe('parseDependencyManifests', () => {
  it('parses package.json with deps and devDeps', () => {
    const tmpDir = makeTmpDir();
    const pkgJson = {
      name: 'my-app',
      version: '1.0.0',
      dependencies: { express: '^4.18.0' },
      devDependencies: { typescript: '^5.0.0' },
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson));

    const files: FileTreeNode[] = [makeFileNode('package.json', 'package.json')];
    const result = parseDependencyManifests(tmpDir, files);

    expect(result).toHaveLength(1);
    const manifest = result[0];
    expect(manifest).toBeDefined();
    if (!manifest) return;

    expect(manifest.name).toBe('my-app');
    expect(manifest.dependencies.find(d => d.name === 'express')?.isDev).toBe(false);
    expect(manifest.dependencies.find(d => d.name === 'typescript')?.isDev).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('parses requirements.txt', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'requirements.txt'),
      'fastapi>=0.100.0\n# comment\nuvicorn==0.23.2\n',
    );

    const files: FileTreeNode[] = [makeFileNode('requirements.txt', 'requirements.txt')];
    const result = parseDependencyManifests(tmpDir, files);

    expect(result).toHaveLength(1);
    const deps = result[0]?.dependencies ?? [];
    expect(deps.map(d => d.name)).toContain('fastapi');
    expect(deps.map(d => d.name)).toContain('uvicorn');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('parses go.mod', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'go.mod'),
      'module github.com/example/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n',
    );

    const files: FileTreeNode[] = [makeFileNode('go.mod', 'go.mod')];
    const result = parseDependencyManifests(tmpDir, files);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('github.com/example/app');
    expect(result[0]?.dependencies.map(d => d.name)).toContain('github.com/gin-gonic/gin');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty array when no manifest files present', () => {
    const tmpDir = makeTmpDir();
    const result = parseDependencyManifests(tmpDir, []);
    expect(result).toHaveLength(0);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('skips malformed package.json gracefully', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'NOT VALID JSON {{{');

    const files: FileTreeNode[] = [makeFileNode('package.json', 'package.json')];
    const result = parseDependencyManifests(tmpDir, files);
    expect(result).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

import { describe, expect, it } from 'vitest';
import { detectLanguages, filterSourceFiles } from '../language-detector.js';
import type { FileTreeNode } from '@geodesic/types';

function makeFile(name: string, filePath: string, language: string | null = null): FileTreeNode {
  return {
    name,
    path: filePath,
    type: 'file',
    language,
    sizeBytes: 100,
    children: [],
    isKeyDirectory: false,
    keyDirectoryType: null,
  };
}

describe('detectLanguages', () => {
  it('identifies TypeScript as primary when majority of files are .ts', () => {
    const files: FileTreeNode[] = [
      makeFile('a.ts', 'src/a.ts', 'TypeScript'),
      makeFile('b.ts', 'src/b.ts', 'TypeScript'),
      makeFile('c.ts', 'src/c.ts', 'TypeScript'),
      makeFile('main.py', 'scripts/main.py', 'Python'),
    ];
    const result = detectLanguages(files);
    expect(result.primary).toBe('TypeScript');
    expect(result.all.map(l => l.language)).toContain('TypeScript');
    expect(result.all.map(l => l.language)).toContain('Python');
  });

  it('returns Python as primary for a Python-only project', () => {
    const files: FileTreeNode[] = [
      makeFile('app.py', 'app.py', 'Python'),
      makeFile('models.py', 'models.py', 'Python'),
      makeFile('routes.py', 'routes.py', 'Python'),
    ];
    const result = detectLanguages(files);
    expect(result.primary).toBe('Python');
  });

  it('ignores non-source files (language=null)', () => {
    const files: FileTreeNode[] = [
      makeFile('README.md', 'README.md', null),
      makeFile('logo.png', 'assets/logo.png', null),
      makeFile('index.ts', 'src/index.ts', 'TypeScript'),
    ];
    const result = detectLanguages(files);
    expect(result.primary).toBe('TypeScript');
    expect(result.all).toHaveLength(1);
  });
});

describe('filterSourceFiles', () => {
  it('excludes files with null language', () => {
    const files: FileTreeNode[] = [
      makeFile('README.md', 'README.md', null),
      makeFile('logo.png', 'logo.png', null),
      makeFile('index.ts', 'src/index.ts', 'TypeScript'),
    ];
    const result = filterSourceFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('index.ts');
  });
});

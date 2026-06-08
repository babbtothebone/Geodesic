import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findPiiCandidates } from '../pii-candidates.js';
import type { FileTreeNode } from '@geodesic/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-pii-test-'));
}

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

describe('findPiiCandidates', () => {
  it('flags files with patient_name fields', () => {
    const tmpDir = makeTmpDir();
    const content = `const q = db.query('SELECT patient_name FROM records');\n`;
    fs.writeFileSync(path.join(tmpDir, 'query.ts'), content);

    const files: FileTreeNode[] = [makeFile('query.ts', 'query.ts')];
    const result = findPiiCandidates(tmpDir, files);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.hint).toMatch(/PHI|PII/);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not flag comment-only lines', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'note.ts'), '// TODO: handle ssn validation\n// patient_name is shown here\n');

    const files: FileTreeNode[] = [makeFile('note.ts', 'note.ts')];
    const result = findPiiCandidates(tmpDir, files);

    expect(result).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('flags console.log with user data', () => {
    const tmpDir = makeTmpDir();
    const content = `console.log('User email:', user.email);\n`;
    fs.writeFileSync(path.join(tmpDir, 'debug.ts'), content);

    const files: FileTreeNode[] = [makeFile('debug.ts', 'debug.ts')];
    const result = findPiiCandidates(tmpDir, files);

    expect(result.length).toBeGreaterThan(0);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('skips node_modules paths', () => {
    const tmpDir = makeTmpDir();
    const nodeModulesFile = makeFile('lib.ts', 'node_modules/somelib/lib.ts');

    const result = findPiiCandidates(tmpDir, [nodeModulesFile]);
    expect(result).toHaveLength(0);
  });

  it('records accurate line numbers', () => {
    const tmpDir = makeTmpDir();
    const content = `const a = 1;\nconst b = 2;\nconst dob = patient.date_of_birth;\n`;
    fs.writeFileSync(path.join(tmpDir, 'model.ts'), content);

    const files: FileTreeNode[] = [makeFile('model.ts', 'model.ts')];
    const result = findPiiCandidates(tmpDir, files);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.lineStart).toBe(3);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

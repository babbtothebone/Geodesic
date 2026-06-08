import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { collectEnvVars } from '../env-var-collector.js';
import type { FileTreeNode } from '@geodesic/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-env-test-'));
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

describe('collectEnvVars', () => {
  it('parses keys from .env file', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_URL=postgres://localhost/db\nPORT=3000\n# comment\n');

    const files: FileTreeNode[] = [makeFile('.env', '.env')];
    const result = collectEnvVars(tmpDir, files);

    const names = result.map(e => e.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('PORT');
    expect(names).not.toContain('# comment');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('marks .env.example as isTemplate=true', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, '.env.example'), 'SECRET_KEY=\nDB_URL=\n');

    const files: FileTreeNode[] = [makeFile('.env.example', '.env.example')];
    const result = collectEnvVars(tmpDir, files);

    expect(result.every(e => e.isTemplate)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('marks secret-sounding vars as isSecret=true', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, '.env'), 'JWT_SECRET=abc\nAPP_NAME=myapp\n');

    const files: FileTreeNode[] = [makeFile('.env', '.env')];
    const result = collectEnvVars(tmpDir, files);

    const jwtEntry = result.find(e => e.name === 'JWT_SECRET');
    const appEntry = result.find(e => e.name === 'APP_NAME');
    expect(jwtEntry?.isSecret).toBe(true);
    expect(appEntry?.isSecret).toBe(false);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('infers purpose for known patterns', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_URL=postgres://localhost/db\n');

    const files: FileTreeNode[] = [makeFile('.env', '.env')];
    const result = collectEnvVars(tmpDir, files);

    const entry = result.find(e => e.name === 'DATABASE_URL');
    expect(entry?.inferredPurpose).toBe('Database connection');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('deduplicates vars seen in multiple env files', () => {
    const tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.env'), 'PORT=3000\n');
    fs.writeFileSync(path.join(tmpDir, '.env.local'), 'PORT=3001\n');

    const files: FileTreeNode[] = [
      makeFile('.env', '.env'),
      makeFile('.env.local', '.env.local'),
    ];
    const result = collectEnvVars(tmpDir, files);

    expect(result.filter(e => e.name === 'PORT')).toHaveLength(1);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

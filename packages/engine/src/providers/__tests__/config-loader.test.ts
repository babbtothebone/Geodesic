import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from '../config-loader.js';

const VALID_CONFIG = {
  provider: 'anthropic' as const,
  apiKey: 'sk-ant-test',
  analystId: 'test@example.com',
};

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads config from explicit path', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(VALID_CONFIG));
    const cfg = loadConfig(configPath);
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.apiKey).toBe('sk-ant-test');
  });

  it('throws if explicit path does not exist', () => {
    expect(() => loadConfig(path.join(tmpDir, 'missing.json'))).toThrow(/not found/i);
  });

  it('throws if explicit path contains invalid JSON', () => {
    const configPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(configPath, '{ invalid json }');
    expect(() => loadConfig(configPath)).toThrow();
  });

  it('throws with setup instructions when no config exists', () => {
    // Pass tmpDir as homeDir so we don't fall back to the real ~/.geodesic/config.json
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      expect(() => loadConfig(undefined, tmpDir)).toThrow(/geodesic config set/i);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('loads from .geodesic/config.json in CWD', () => {
    const geodeDir = path.join(tmpDir, '.geodesic');
    fs.mkdirSync(geodeDir);
    fs.writeFileSync(path.join(geodeDir, 'config.json'), JSON.stringify(VALID_CONFIG));

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const cfg = loadConfig();
      expect(cfg.provider).toBe('anthropic');
    } finally {
      process.chdir(originalCwd);
    }
  });
});

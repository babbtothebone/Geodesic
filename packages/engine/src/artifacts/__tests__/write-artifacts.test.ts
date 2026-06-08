import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeArtifacts } from '../index.js';
import { makeSynthesisResult } from './fixtures.js';

describe('writeArtifacts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-artifacts-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates output directory if it does not exist', () => {
    const outputDir = path.join(tmpDir, 'nested', 'output');
    writeArtifacts(makeSynthesisResult(), outputDir);
    expect(fs.existsSync(outputDir)).toBe(true);
  });

  it('returns paths to all four artifact files', () => {
    const outputDir = path.join(tmpDir, 'out');
    const paths = writeArtifacts(makeSynthesisResult(), outputDir);
    expect(paths.architectureMap).toContain('architecture-map.md');
    expect(paths.skillFileJson).toContain('skill-file.geodesic.json');
    expect(paths.skillFileMd).toContain('skill-file.geodesic.md');
    expect(paths.gapReport).toContain('gap-report.md');
  });

  it('writes all four files to disk', () => {
    const outputDir = path.join(tmpDir, 'out');
    const paths = writeArtifacts(makeSynthesisResult(), outputDir);
    expect(fs.existsSync(paths.architectureMap)).toBe(true);
    expect(fs.existsSync(paths.skillFileJson)).toBe(true);
    expect(fs.existsSync(paths.skillFileMd)).toBe(true);
    expect(fs.existsSync(paths.gapReport)).toBe(true);
  });

  it('skill-file.geodesic.json is valid JSON with $schema field', () => {
    const outputDir = path.join(tmpDir, 'out');
    const paths = writeArtifacts(makeSynthesisResult(), outputDir);
    const raw = fs.readFileSync(paths.skillFileJson, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['$schema']).toBe('https://geodesic.dev/schema/v1/skill-file.json');
  });

  it('architecture-map.md contains repo name and PHI zone coordinates', () => {
    const outputDir = path.join(tmpDir, 'out');
    const paths = writeArtifacts(makeSynthesisResult(), outputDir);
    const content = fs.readFileSync(paths.architectureMap, 'utf8');
    expect(content).toContain('my-app — Architecture Map');
    expect(content).toContain('src/db/schema.ts — Lines 45–89');
  });

  it('gap-report.md contains overall score and findings', () => {
    const outputDir = path.join(tmpDir, 'out');
    const paths = writeArtifacts(makeSynthesisResult(), outputDir);
    const content = fs.readFileSync(paths.gapReport, 'utf8');
    expect(content).toContain('Geodesic Gap Report');
    expect(content).toContain('62/100');
    expect(content).toContain('P0 — Critical Findings');
  });

  it('produces identical output on two consecutive runs (deterministic)', () => {
    const out1 = path.join(tmpDir, 'run1');
    const out2 = path.join(tmpDir, 'run2');
    const synthesis = makeSynthesisResult();
    const p1 = writeArtifacts(synthesis, out1);
    const p2 = writeArtifacts(synthesis, out2);

    const readAll = (p: ReturnType<typeof writeArtifacts>) => ({
      arch: fs.readFileSync(p.architectureMap, 'utf8'),
      json: fs.readFileSync(p.skillFileJson, 'utf8'),
      md: fs.readFileSync(p.skillFileMd, 'utf8'),
      gap: fs.readFileSync(p.gapReport, 'utf8'),
    });

    const r1 = readAll(p1);
    const r2 = readAll(p2);
    expect(r1.arch).toBe(r2.arch);
    expect(r1.json).toBe(r2.json);
    expect(r1.md).toBe(r2.md);
    expect(r1.gap).toBe(r2.gap);
  });
});

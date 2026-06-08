import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  canonicalize,
  computeRecordHash,
  ChainBuilder,
  writeChainFile,
  verifyChainFile,
  ZERO_HASH,
} from '../chain-writer.js';

describe('canonicalize', () => {
  it('produces stable key order regardless of input order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('handles nested objects and arrays', () => {
    const a = { x: [{ b: 1, a: 2 }, 3], y: null };
    const b = { y: null, x: [{ a: 2, b: 1 }, 3] };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('emits no whitespace', () => {
    expect(canonicalize({ a: 1 })).not.toMatch(/\s/);
  });
});

describe('ChainBuilder', () => {
  it('seeds seq=1 with prevHash=ZERO_HASH', () => {
    const c = new ChainBuilder();
    const r = c.append({ kind: 'x' });
    expect(r.seq).toBe(1);
    expect(r.prevHash).toBe(ZERO_HASH);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chains hashes: record N+1 prevHash equals record N hash', () => {
    const c = new ChainBuilder();
    const r1 = c.append({ kind: 'a' });
    const r2 = c.append({ kind: 'b' });
    const r3 = c.append({ kind: 'c' });
    expect(r2.prevHash).toBe(r1.hash);
    expect(r3.prevHash).toBe(r2.hash);
    expect(c.tipHash()).toBe(r3.hash);
  });

  it('produces identical hashes for identical inputs', () => {
    const a = new ChainBuilder().append({ kind: 'x', n: 1 });
    const b = new ChainBuilder().append({ kind: 'x', n: 1 });
    expect(a.hash).toBe(b.hash);
  });

  it('produces different hashes for different content', () => {
    const a = new ChainBuilder().append({ kind: 'x' });
    const b = new ChainBuilder().append({ kind: 'y' });
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('computeRecordHash', () => {
  it('ignores any pre-existing hash field on the input', () => {
    const h1 = computeRecordHash(ZERO_HASH, { kind: 'x' });
    const h2 = computeRecordHash(ZERO_HASH, { kind: 'x', hash: 'pretend' });
    expect(h1).toBe(h2);
  });
});

describe('writeChainFile + verifyChainFile', () => {
  function tmpPath(): string {
    return path.join(os.tmpdir(), `chain-${String(Date.now())}-${String(Math.random()).slice(2)}.jsonl`);
  }

  it('round-trips a valid chain', () => {
    const c = new ChainBuilder();
    c.append({ kind: 'a' });
    c.append({ kind: 'b' });
    c.append({ kind: 'c' });
    const p = tmpPath();
    writeChainFile(p, c.records);
    const result = verifyChainFile(p);
    expect(result.ok).toBe(true);
    expect(result.recordsChecked).toBe(3);
    fs.unlinkSync(p);
  });

  it('writes empty file for empty chain', () => {
    const p = tmpPath();
    writeChainFile(p, []);
    expect(fs.readFileSync(p, 'utf8')).toBe('');
    fs.unlinkSync(p);
  });

  it('detects a tampered record value', () => {
    const c = new ChainBuilder();
    c.append({ kind: 'a', value: 'original' });
    c.append({ kind: 'b' });
    const p = tmpPath();
    writeChainFile(p, c.records);

    // Tamper with the first record's value but keep its hash
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
    const r0 = JSON.parse(lines[0]!) as Record<string, unknown>;
    r0.value = 'TAMPERED';
    lines[0] = JSON.stringify(r0);
    fs.writeFileSync(p, lines.join('\n') + '\n');

    const result = verifyChainFile(p);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenSeq).toBe(1);
    expect(result.reason).toMatch(/hash mismatch/);
    fs.unlinkSync(p);
  });

  it('detects a broken prevHash link', () => {
    const c = new ChainBuilder();
    c.append({ kind: 'a' });
    c.append({ kind: 'b' });
    const p = tmpPath();
    writeChainFile(p, c.records);

    // Break the chain link on record 2
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
    const r1 = JSON.parse(lines[1]!) as Record<string, unknown>;
    r1.prevHash = ZERO_HASH;
    lines[1] = JSON.stringify(r1);
    fs.writeFileSync(p, lines.join('\n') + '\n');

    const result = verifyChainFile(p);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenSeq).toBe(2);
  });

  it('detects out-of-order seq', () => {
    const c = new ChainBuilder();
    c.append({ kind: 'a' });
    c.append({ kind: 'b' });
    const p = tmpPath();
    writeChainFile(p, c.records);

    const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
    const r1 = JSON.parse(lines[1]!) as Record<string, unknown>;
    r1.seq = 99;
    lines[1] = JSON.stringify(r1);
    fs.writeFileSync(p, lines.join('\n') + '\n');

    const result = verifyChainFile(p);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/seq/);
  });
});

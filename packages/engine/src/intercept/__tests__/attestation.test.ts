import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AttestationChain, computeHash, readAttestationFile } from '../attestation.js';

function makeChain(): AttestationChain {
  return new AttestationChain();
}

const BASE_PARAMS = {
  analystId: 'test@example.com',
  repo: 'test/repo',
  repoCommit: 'abc123',
  file: '[payload:meta.repoPath]',
  lineStart: 1,
  lineEnd: 1,
  colStart: 0,
  colEnd: 10,
  hipaaIdentifier: null,
  hipaaSafeHarborItem: null,
  payloadHash: 'sha256:abc',
} as const;

describe('computeHash', () => {
  it('returns a sha256: prefixed string', () => {
    const hash = computeHash('hello');
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeHash('data')).toBe(computeHash('data'));
  });

  it('produces different hashes for different inputs', () => {
    expect(computeHash('aaa')).not.toBe(computeHash('bbb'));
  });
});

describe('AttestationChain', () => {
  it('assigns sequential chainSeq values', () => {
    const chain = makeChain();
    const e1 = chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    const e2 = chain.addEntry({ ...BASE_PARAMS, entryId: 'bb02', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:bb02:CONF:HIGH]' });
    expect(e1.chainSeq).toBe(1);
    expect(e2.chainSeq).toBe(2);
  });

  it('first entry has genesis prevHash (64 zeros)', () => {
    const chain = makeChain();
    const e = chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    expect(e.prevHash).toBe('0'.repeat(64));
  });

  it('thisHash is a sha256: prefixed string', () => {
    const chain = makeChain();
    const e = chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    expect(e.thisHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('second entry prevHash is sha256 of first full entry JSON', () => {
    const chain = makeChain();
    const e1 = chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    const e2 = chain.addEntry({ ...BASE_PARAMS, entryId: 'bb02', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:bb02:CONF:HIGH]' });
    expect(e2.prevHash).toBe(computeHash(JSON.stringify(e1)));
  });

  it('chain verification passes for a valid chain', () => {
    const chain = makeChain();
    chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    chain.addEntry({ ...BASE_PARAMS, entryId: 'bb02', piiCategory: 'PII', piiType: 'IP_ADDRESS', scrubConfidence: 'HIGH', tokenPlaced: '[PII:IP_ADDRESS:ref:bb02:CONF:HIGH]' });
    const result = AttestationChain.verify(chain.getEntries());
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('chain verification fails for tampered thisHash', () => {
    const chain = makeChain();
    chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    const entries = chain.getEntries();
    const tampered = entries.map((e, i) =>
      i === 0 ? { ...e, thisHash: 'sha256:' + 'f'.repeat(64) } : e,
    );
    const result = AttestationChain.verify(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tampered/i);
  });

  it('writes and reads a JSONL file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-attest-'));
    const outPath = path.join(tmpDir, 'attestation.jsonl');

    const chain = makeChain();
    chain.addEntry({ ...BASE_PARAMS, entryId: 'aa01', piiCategory: 'PHI', piiType: 'EMAIL', scrubConfidence: 'HIGH', tokenPlaced: '[PHI:EMAIL:ref:aa01:CONF:HIGH]' });
    chain.addEntry({ ...BASE_PARAMS, entryId: 'bb02', piiCategory: 'SECRET', piiType: 'API_KEY', scrubConfidence: 'HIGH', tokenPlaced: '[SECRET:API_KEY:ref:bb02:CONF:HIGH]' });
    chain.writeToFile(outPath);

    const loaded = readAttestationFile(outPath);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.entryId).toBe('aa01');
    expect(loaded[1]?.entryId).toBe('bb02');

    fs.rmSync(tmpDir, { recursive: true });
  });
});

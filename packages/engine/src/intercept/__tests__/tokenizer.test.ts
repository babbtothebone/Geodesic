import { describe, expect, it } from 'vitest';
import { buildToken, generateRefId, applyReplacements } from '../tokenizer.js';

describe('buildToken', () => {
  it('builds a HIGH-confidence PHI token', () => {
    const token = buildToken('PHI', 'PERSON_NAME', 'a3f2', 'HIGH');
    expect(token).toBe('[PHI:PERSON_NAME:ref:a3f2:CONF:HIGH]');
  });

  it('adds REVIEW_REQUIRED for UNCERTAIN confidence', () => {
    const token = buildToken('PHI', 'POSSIBLE_PERSON_NAME', 'h203', 'UNCERTAIN');
    expect(token).toBe('[PHI:POSSIBLE_PERSON_NAME:ref:h203:CONF:UNCERTAIN:REVIEW_REQUIRED]');
  });

  it('adds REVIEW_REQUIRED for LOW confidence', () => {
    const token = buildToken('PHI', 'POSSIBLE_ZIP_CODE', 'i819', 'LOW');
    expect(token).toBe('[PHI:POSSIBLE_ZIP_CODE:ref:i819:CONF:LOW:REVIEW_REQUIRED]');
  });

  it('builds a SECRET token', () => {
    const token = buildToken('SECRET', 'API_KEY', 'f882', 'HIGH');
    expect(token).toBe('[SECRET:API_KEY:ref:f882:CONF:HIGH]');
  });
});

describe('generateRefId', () => {
  it('generates a 4-character alphanumeric string', () => {
    const used = new Set<string>();
    const id = generateRefId(used);
    expect(id).toMatch(/^[a-z0-9]{4}$/);
  });

  it('avoids collisions', () => {
    const used = new Set<string>();
    const ids = Array.from({ length: 100 }, () => generateRefId(used));
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });

  it('adds generated ID to the used set', () => {
    const used = new Set<string>();
    const id = generateRefId(used);
    expect(used.has(id)).toBe(true);
  });
});

describe('applyReplacements', () => {
  it('replaces a single detection correctly', () => {
    const value = 'email: user@example.com is here';
    const detections = [{ startIndex: 7, endIndex: 23 }];
    const tokens = ['[PII:EMAIL:ref:xxxx:CONF:HIGH]'];
    const result = applyReplacements(value, detections, tokens);
    expect(result).toBe('email: [PII:EMAIL:ref:xxxx:CONF:HIGH] is here');
  });

  it('replaces multiple detections right-to-left, preserving positions', () => {
    const value = 'a@b.com and c@d.com';
    const detections = [
      { startIndex: 0, endIndex: 7 },
      { startIndex: 12, endIndex: 19 },
    ];
    const tokens = ['[T1]', '[T2]'];
    const result = applyReplacements(value, detections, tokens);
    expect(result).toBe('[T1] and [T2]');
  });
});

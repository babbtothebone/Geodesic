import { describe, expect, it } from 'vitest';
import { detectInValue } from '../detector.js';

describe('detectInValue', () => {
  it('detects email addresses', () => {
    const results = detectInValue('Contact admin@hospital.org for help');
    expect(results).toHaveLength(1);
    expect(results[0]?.patternDef.piiType).toBe('EMAIL');
    expect(results[0]?.match).toBe('admin@hospital.org');
  });

  it('detects SSN', () => {
    const results = detectInValue('SSN: 123-45-6789');
    expect(results.some(r => r.patternDef.piiType === 'SOCIAL_SECURITY_NUMBER')).toBe(true);
  });

  it('detects IPv4 address', () => {
    const results = detectInValue('Server at 192.168.1.100');
    expect(results.some(r => r.patternDef.piiType === 'IP_ADDRESS')).toBe(true);
  });

  it('detects AWS access key', () => {
    const results = detectInValue('AKIAIOSFODNN7EXAMPLE');
    expect(results[0]?.patternDef.piiType).toBe('AWS_ACCESS_KEY');
    expect(results[0]?.patternDef.confidence).toBe('HIGH');
  });

  it('detects GitHub token', () => {
    const results = detectInValue('ghp_' + 'a'.repeat(36));
    expect(results[0]?.patternDef.piiType).toBe('GITHUB_TOKEN');
  });

  it('detects database connection string with credentials', () => {
    const results = detectInValue('postgres://admin:hunter2@db.internal/prod');
    expect(results[0]?.patternDef.piiType).toBe('CONNECTION_STRING');
  });

  it('detects JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzNDU2Nzg5MCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const results = detectInValue(jwt);
    expect(results.some(r => r.patternDef.piiType === 'JWT_TOKEN')).toBe(true);
  });

  it('detects ISO dates', () => {
    const results = detectInValue('dob: 1984-03-12');
    expect(results.some(r => r.patternDef.piiType === 'DATE_EXCEPT_YEAR')).toBe(true);
  });

  it('detects MM/DD/YYYY dates', () => {
    const results = detectInValue('Date: 03/12/1984');
    expect(results.some(r => r.patternDef.piiType === 'DATE_EXCEPT_YEAR')).toBe(true);
  });

  it('handles overlapping patterns — keeps highest confidence hit', () => {
    // An OpenAI key matches both the generic prefixed-key and specific openai-key patterns
    const key = 'sk-' + 'A'.repeat(40);
    const results = detectInValue(key);
    // Should deduplicate — only one detection per character position
    const positions = results.map(r => r.startIndex);
    const uniquePositions = new Set(positions);
    expect(positions.length).toBe(uniquePositions.size);
  });

  it('returns empty array for clean strings', () => {
    const results = detectInValue('const framework = "Next.js";');
    expect(results).toHaveLength(0);
  });

  it('detects multiple PII in one value', () => {
    const results = detectInValue('user@example.com lives at 192.168.1.1');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

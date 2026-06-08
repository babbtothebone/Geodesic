import { describe, expect, it } from 'vitest';
import { verifyPurity } from '../purity.js';

describe('verifyPurity', () => {
  it('returns clean for a plain object payload', () => {
    const result = verifyPurity({ framework: 'Next.js', language: 'TypeScript' });
    expect(result.clean).toBe(true);
  });

  it('detects an email that survived scrubbing', () => {
    const result = verifyPurity({ contact: 'admin@hospital.org' });
    expect(result.clean).toBe(false);
    expect(result.firstMatchPattern).toMatch(/email/i);
  });

  it('detects an SSN that survived scrubbing', () => {
    const result = verifyPurity('ssn is 123-45-6789 here');
    expect(result.clean).toBe(false);
  });

  it('detects an AWS key that survived scrubbing', () => {
    const result = verifyPurity('AKIAIOSFODNN7EXAMPLE');
    expect(result.clean).toBe(false);
    expect(result.firstMatchPattern).toMatch(/aws/i);
  });

  it('tokens produced by the scrubber do NOT trigger purity failure', () => {
    const result = verifyPurity({
      email: '[PHI:EMAIL:ref:a3f2:CONF:HIGH]',
      name: '[PHI:PERSON_NAME:ref:b891:CONF:HIGH]',
      key: '[SECRET:API_KEY:ref:c114:CONF:HIGH]',
    });
    expect(result.clean).toBe(true);
  });

  it('reports position of first match within the string value', () => {
    const result = verifyPurity('prefix admin@example.com suffix');
    expect(result.clean).toBe(false);
    expect(result.firstMatchPosition).toBeGreaterThanOrEqual(0);
  });

  it('does NOT false-positive on JSON escape sequences like \\n@app.route', () => {
    // This was a real false positive: Python @decorator on a new line, stored in a
    // markdown content field. JSON serialization turns \n into \+n, making the regex
    // see "n@app.route" as an email. verifyPurity must check the raw string value,
    // not the serialized JSON, to avoid this.
    const result = verifyPurity({
      content: 'Example code:\n@app.route("/webhook")\ndef handle(): pass',
    });
    expect(result.clean).toBe(true);
  });

  it('walks nested objects and arrays', () => {
    const result = verifyPurity({
      files: [{ content: 'hello world' }, { content: 'more text' }],
      meta: { status: 'ok' },
    });
    expect(result.clean).toBe(true);
  });

  it('finds an email nested deep in an object', () => {
    const result = verifyPurity({
      level1: { level2: { level3: { inferredPurpose: 'contact: real@example.com' } } },
    });
    expect(result.clean).toBe(false);
    expect(result.firstMatchPattern).toMatch(/email/i);
  });
});

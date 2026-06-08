import { describe, it, expect } from 'vitest';
import { localEmbed, normalizeTo1536 } from '../local-embeddings.js';

describe('localEmbed', () => {
  it('returns a 1536-dimensional vector', async () => {
    const result = await localEmbed('hello world');
    expect(result.embedding).toHaveLength(1536);
  });

  it('returns a unit vector (L2 norm ≈ 1)', async () => {
    const result = await localEmbed('some text for embedding');
    const norm = Math.sqrt(result.embedding.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('is deterministic — same text produces same vector', async () => {
    const a = await localEmbed('deterministic test');
    const b = await localEmbed('deterministic test');
    expect(a.embedding).toEqual(b.embedding);
  });

  it('produces different vectors for different texts', async () => {
    const a = await localEmbed('first sentence');
    const b = await localEmbed('something completely different');
    expect(a.embedding).not.toEqual(b.embedding);
  });

  it('reports non-zero inputTokens', async () => {
    const result = await localEmbed('token count test');
    expect(result.inputTokens).toBeGreaterThan(0);
  });
});

describe('normalizeTo1536', () => {
  it('returns same array when already 1536', () => {
    const v = new Array<number>(1536).fill(0.5);
    const out = normalizeTo1536(v);
    expect(out).toHaveLength(1536);
  });

  it('pads shorter vectors to 1536', () => {
    const v = new Array<number>(768).fill(0.1);
    const out = normalizeTo1536(v);
    expect(out).toHaveLength(1536);
  });

  it('downsamples longer vectors to 1536', () => {
    const v = new Array<number>(3072).fill(0.2);
    const out = normalizeTo1536(v);
    expect(out).toHaveLength(1536);
  });

  it('output is unit-normalized', () => {
    const v = [1, 2, 3, 4, 5];
    const out = normalizeTo1536(v);
    const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it('handles all-zero input without divide-by-zero crash', () => {
    const v = new Array<number>(100).fill(0);
    expect(() => normalizeTo1536(v)).not.toThrow();
  });
});

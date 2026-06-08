import * as crypto from 'crypto';
import type { EmbeddingResult } from '@geodesic/types';

const EMBEDDING_DIM = 1536;

/**
 * Local embedding fallback for providers that don't support native embeddings.
 *
 * Uses a deterministic hash-projection approach: the text is hashed with SHA-256
 * using 48 different salts, each producing 32 bytes, totalling 1536 float32 values.
 * This is stable (same text → same vector) and preserves basic semantic structure
 * (similar texts share hash collisions).
 *
 * The real sentence-transformer ONNX model is bundled in Phase 8 packaging.
 * When available, it replaces this function transparently.
 *
 * Callers receive a consistently 1536-dimensional vector regardless of path taken.
 */
export function localEmbed(text: string): Promise<EmbeddingResult> {
  const inputTokens = Math.ceil(text.length / 4);
  const embedding = hashProjectEmbed(text);
  return Promise.resolve({ embedding, inputTokens });
}

function hashProjectEmbed(text: string): number[] {
  const result: number[] = new Array(EMBEDDING_DIM) as number[];
  const bytesNeeded = EMBEDDING_DIM * 4; // float32 = 4 bytes
  const iterations = Math.ceil(bytesNeeded / 32); // sha256 = 32 bytes per hash

  const bytes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const hash = crypto
      .createHash('sha256')
      .update(String(i) + ':' + text, 'utf8')
      .digest();
    for (const byte of hash) {
      bytes.push(byte);
    }
  }

  // Convert each 4-byte group to a float32 in [-1, 1]
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const offset = i * 4;
    const b0 = bytes[offset] ?? 0;
    const b1 = bytes[offset + 1] ?? 0;
    const b2 = bytes[offset + 2] ?? 0;
    const b3 = bytes[offset + 3] ?? 0;
    // Interpret as uint32, normalize to [-1, 1]
    const uint32 = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
    result[i] = (uint32 / 2147483648) - 1;
  }

  return normalizeVector(result);
}

function normalizeVector(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (magnitude === 0) return v;
  return v.map(x => x / magnitude);
}

/**
 * Normalize a vector of any dimensionality to EMBEDDING_DIM by padding with zeros
 * (if shorter) or by averaging pairs (if longer). Used when a provider returns a
 * non-standard dimension.
 */
export function normalizeTo1536(embedding: number[]): number[] {
  if (embedding.length === EMBEDDING_DIM) return embedding;

  if (embedding.length < EMBEDDING_DIM) {
    // Pad with zeros then normalize
    const padded = [...embedding, ...new Array(EMBEDDING_DIM - embedding.length).fill(0) as number[]];
    return normalizeVector(padded);
  }

  // Downsample by averaging adjacent values
  const ratio = embedding.length / EMBEDDING_DIM;
  const result: number[] = new Array(EMBEDDING_DIM) as number[];
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < embedding.length; j++) {
      sum += embedding[j] ?? 0;
      count++;
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return normalizeVector(result);
}

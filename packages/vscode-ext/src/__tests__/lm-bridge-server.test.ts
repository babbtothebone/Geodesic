/**
 * Tests for LmBridgeServer — focused on the multi-window lockfile sharing,
 * auth, and dispose contracts that previously caused "invalid X-Bridge-Token"
 * errors when multiple VS Code windows ran Geodesic.
 *
 * vscode.lm is mocked because it is unavailable in a Node test env.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => {
  class LanguageModelError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  }
  return {
    Disposable: class { dispose() { /* noop */ } },
    EventEmitter: class { event = () => ({ dispose() { /* noop */ } }); fire() { /* noop */ } dispose() { /* noop */ } },
    CancellationTokenSource: class { token = {}; cancel() { /* noop */ } dispose() { /* noop */ } },
    LanguageModelChatMessage: { User: (s: string) => ({ role: 'user', content: s }), Assistant: (s: string) => ({ role: 'assistant', content: s }) },
    LanguageModelError,
    lm: { selectChatModels: vi.fn(async () => []) },
  };
});

// Sandbox the lockfile to a temp HOME so concurrent tests don't collide
// with the real ~/.geodesic/bridge.json. Must be set BEFORE importing.
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-bridge-test-'));
process.env.HOME = SANDBOX_HOME;

// vi.mock('vscode', ...) above is hoisted by vitest to the top of the module,
// so a plain static import here still sees the mock — no top-level await needed.
import { LmBridgeServer } from '../lm-bridge-server.js';
const LOCKFILE = path.join(SANDBOX_HOME, '.geodesic', 'bridge.json');

afterEach(() => {
  try { fs.unlinkSync(LOCKFILE); } catch { /* ignore */ }
});

describe('LmBridgeServer — single instance', () => {
  it('binds a port and writes lockfile with this PID on first start', async () => {
    const server = new LmBridgeServer();
    const info = await server.start();
    try {
      expect(info.port).toBeGreaterThan(0);
      expect(info.token).toMatch(/^[a-f0-9]{48}$/);
      expect(server.isOwner).toBe(true);
      expect(fs.existsSync(LOCKFILE)).toBe(true);
      const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
      expect(lock.port).toBe(info.port);
      expect(lock.token).toBe(info.token);
      expect(lock.pid).toBe(process.pid);
    } finally {
      server.dispose();
    }
  });

  it('owner dispose deletes the lockfile', async () => {
    const server = new LmBridgeServer();
    await server.start();
    expect(fs.existsSync(LOCKFILE)).toBe(true);
    server.dispose();
    expect(fs.existsSync(LOCKFILE)).toBe(false);
  });

  it('rejects requests with missing X-Bridge-Token (401)', async () => {
    const server = new LmBridgeServer();
    const { port } = await server.start();
    try {
      const resp = await fetch(`http://127.0.0.1:${String(port)}/lm/health`);
      expect(resp.status).toBe(401);
      const body = await resp.json() as { error: { code: string } };
      expect(body.error.code).toBe('AUTH_FAILED');
    } finally {
      server.dispose();
    }
  });

  it('rejects requests with wrong token (401)', async () => {
    const server = new LmBridgeServer();
    const { port } = await server.start();
    try {
      const resp = await fetch(`http://127.0.0.1:${String(port)}/lm/health`, {
        headers: { 'X-Bridge-Token': 'wrong-token-value' },
      });
      expect(resp.status).toBe(401);
    } finally {
      server.dispose();
    }
  });

  it('accepts requests with correct token (200)', async () => {
    const server = new LmBridgeServer();
    const { port, token } = await server.start();
    try {
      const resp = await fetch(`http://127.0.0.1:${String(port)}/lm/health`, {
        headers: { 'X-Bridge-Token': token },
      });
      expect(resp.status).toBe(200);
    } finally {
      server.dispose();
    }
  });
});

describe('LmBridgeServer — multi-window sharing', () => {
  it('second instance reuses the first instance port and token', async () => {
    const owner = new LmBridgeServer();
    const ownerInfo = await owner.start();
    const follower = new LmBridgeServer();
    const followerInfo = await follower.start();
    try {
      expect(followerInfo.port).toBe(ownerInfo.port);
      expect(followerInfo.token).toBe(ownerInfo.token);
      expect(follower.isOwner).toBe(false);
      expect(owner.isOwner).toBe(true);
    } finally {
      follower.dispose();
      owner.dispose();
    }
  });

  it('follower dispose does NOT delete the lockfile', async () => {
    const owner = new LmBridgeServer();
    await owner.start();
    const follower = new LmBridgeServer();
    await follower.start();
    try {
      expect(fs.existsSync(LOCKFILE)).toBe(true);
      follower.dispose();
      expect(fs.existsSync(LOCKFILE)).toBe(true);
    } finally {
      owner.dispose();
    }
    expect(fs.existsSync(LOCKFILE)).toBe(false);
  });

  it('reclaims ownership when lockfile points to dead PID', async () => {
    fs.mkdirSync(path.dirname(LOCKFILE), { recursive: true });
    fs.writeFileSync(LOCKFILE, JSON.stringify({
      port: 1,
      token: 'stale-token',
      pid: 2147483646,
      startedAt: '1970-01-01T00:00:00.000Z',
    }));
    const reclaimer = new LmBridgeServer();
    const info = await reclaimer.start();
    try {
      expect(reclaimer.isOwner).toBe(true);
      expect(info.token).not.toBe('stale-token');
      const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
      expect(lock.pid).toBe(process.pid);
    } finally {
      reclaimer.dispose();
    }
  });

  it('two windows produce identical port and token (multi-window auth)', async () => {
    const owner = new LmBridgeServer();
    const ownerInfo = await owner.start();
    const follower = new LmBridgeServer();
    const followerInfo = await follower.start();
    try {
      expect(followerInfo.token).toBe(ownerInfo.token);
      expect(followerInfo.port).toBe(ownerInfo.port);
      const resp = await fetch(`http://127.0.0.1:${String(followerInfo.port)}/lm/health`, {
        headers: { 'X-Bridge-Token': followerInfo.token },
      });
      expect(resp.status).toBe(200);
    } finally {
      follower.dispose();
      owner.dispose();
    }
  });
});

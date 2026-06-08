/**
 * Tests for the Copilot provider — verifies bridge integration without
 * hitting vscode.lm (which is unavailable in Node). The bridge is exercised
 * via the GEODESIC_LM_BRIDGE_PORT/TOKEN env vars; we stand up a fake
 * loopback HTTP server that plays the role of the extension-host bridge.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createProvider } from '../copilot.js';
import type { GeodesicConfig, Message } from '@geodesic/types';
import { ProviderError } from '@geodesic/types';

let fakeServer: http.Server;
let fakePort = 0;
const FAKE_TOKEN = 'test-token-deadbeef';

let handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void = (_req, res) => {
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'UNKNOWN', message: 'no handler set', retryable: false } }));
};

beforeAll(async () => {
  fakeServer = http.createServer((req, res) => {
    if (req.headers['x-bridge-token'] !== FAKE_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'AUTH_FAILED', message: 'bad token', retryable: false } }));
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => {
    fakeServer.listen(0, '127.0.0.1', () => {
      fakePort = (fakeServer.address() as AddressInfo).port;
      resolve();
    });
  });
  process.env.GEODESIC_LM_BRIDGE_PORT = String(fakePort);
  process.env.GEODESIC_LM_BRIDGE_TOKEN = FAKE_TOKEN;
});

afterAll(async () => {
  delete process.env.GEODESIC_LM_BRIDGE_PORT;
  delete process.env.GEODESIC_LM_BRIDGE_TOKEN;
  await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
});

beforeEach(() => {
  handler = (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'UNKNOWN', message: 'no handler set', retryable: false } }));
  };
});

const baseConfig: GeodesicConfig = { provider: 'copilot', analystId: 'test' };

describe('copilot provider — construction', () => {
  it('reports provider name "copilot"', () => {
    const p = createProvider(baseConfig);
    expect(p.name).toBe('copilot');
  });

  it('uses claude-3.5-sonnet as default family', () => {
    const p = createProvider(baseConfig);
    expect(p.defaultModel).toBe('claude-3.5-sonnet');
  });

  it('respects custom family from copilot config block', () => {
    const p = createProvider({ ...baseConfig, copilot: { family: 'gpt-4o' } });
    expect(p.defaultModel).toBe('gpt-4o');
  });

  it('estimateCost always returns $0 (Copilot subscription bundled)', () => {
    const p = createProvider(baseConfig);
    const est = p.estimateCost([{ role: 'user', content: 'hello world' }]);
    expect(est.estimatedCostUsd).toBe(0);
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
  });
});

describe('copilot provider — complete()', () => {
  it('forwards messages to bridge and returns its response', async () => {
    handler = (req, res, body) => {
      expect(req.url).toBe('/lm/complete');
      const parsed = JSON.parse(body) as { messages: Message[]; family: string };
      expect(parsed.messages[0]?.content).toBe('hello');
      expect(parsed.family).toBe('claude-3.5-sonnet');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        content: 'world',
        inputTokens: 10,
        outputTokens: 5,
        model: 'claude-3.5-sonnet',
      }));
    };
    const p = createProvider(baseConfig);
    const result = await p.complete(
      [{ role: 'user', content: 'hello' }],
      { maxTokens: 100, temperature: 0.1 },
    );
    expect(result.content).toBe('world');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.provider).toBe('copilot');
  });

  it('strips system role messages and forwards systemPrompt option separately', async () => {
    handler = (_req, res, body) => {
      const parsed = JSON.parse(body) as { messages: Message[]; systemPrompt: string };
      expect(parsed.messages.every(m => m.role !== 'system')).toBe(true);
      expect(parsed.systemPrompt).toBe('You are Geodesic.');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: 'ok', inputTokens: 1, outputTokens: 1, model: 'x' }));
    };
    const p = createProvider(baseConfig);
    await p.complete(
      [
        { role: 'system', content: 'ignored' },
        { role: 'user', content: 'hi' },
      ],
      { maxTokens: 100, temperature: 0.1, systemPrompt: 'You are Geodesic.' },
    );
  });

  it('maps bridge 401 (AUTH_FAILED) to ProviderError with AUTH_FAILED', async () => {
    process.env.GEODESIC_LM_BRIDGE_TOKEN = 'wrong';
    const p = createProvider(baseConfig);
    await expect(
      p.complete([{ role: 'user', content: 'x' }], { maxTokens: 10, temperature: 0 }),
    ).rejects.toThrow(ProviderError);
    process.env.GEODESIC_LM_BRIDGE_TOKEN = FAKE_TOKEN;
  });

  it('maps bridge 503 MODEL_NOT_FOUND to ProviderError with MODEL_NOT_FOUND', async () => {
    handler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { code: 'MODEL_NOT_FOUND', message: 'no model', retryable: false },
      }));
    };
    const p = createProvider(baseConfig);
    try {
      await p.complete([{ role: 'user', content: 'x' }], { maxTokens: 10, temperature: 0 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe('MODEL_NOT_FOUND');
    }
  });

  it('throws NETWORK_ERROR with remediation hint when bridge port is unset', async () => {
    const port = process.env.GEODESIC_LM_BRIDGE_PORT;
    delete process.env.GEODESIC_LM_BRIDGE_PORT;
    const p = createProvider(baseConfig);
    try {
      await p.complete([{ role: 'user', content: 'x' }], { maxTokens: 10, temperature: 0 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe('NETWORK_ERROR');
      expect((err as ProviderError).message).toMatch(/VS Code|extension/i);
    }
    if (port !== undefined) process.env.GEODESIC_LM_BRIDGE_PORT = port;
  });
});

describe('copilot provider — healthCheck()', () => {
  it('returns healthy: true when bridge reports ok', async () => {
    handler = (req, res) => {
      expect(req.url).toBe('/lm/health');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '2 models' }));
    };
    const p = createProvider(baseConfig);
    const hc = await p.healthCheck();
    expect(hc.healthy).toBe(true);
    expect(hc.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns healthy: false with error message when bridge reports unavailable', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'No models — sign into Copilot' }));
    };
    const p = createProvider(baseConfig);
    const hc = await p.healthCheck();
    expect(hc.healthy).toBe(false);
    expect(hc.error).toContain('Copilot');
  });
});

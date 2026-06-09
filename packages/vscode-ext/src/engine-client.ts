import * as http from 'http';

export interface EngineHealth { ok: boolean; version: string }
export interface EngineJobResponse { jobId: string; status: string }

function request<T>(port: number, token: string, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        // Every engine route except GET /health requires this header (see http-server.ts
        // isAuthorized). Token is per-engine-launch and arrives via stdout when the
        // extension spawns the engine subprocess.
        'X-Geodesic-Token': token,
        ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as T;
          resolve(parsed);
        } catch {
          reject(new Error(`Invalid JSON response from engine: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('Engine request timed out')); });

    if (payload) req.write(payload);
    req.end();
  });
}

export class EngineClient {
  // Token is per-engine-launch and must be threaded through every authenticated
  // request. Read off the engine subprocess stdout by EngineManager (see TOKEN_PATTERN
  // in engine-manager.ts) and handed to this client when the port becomes known.
  constructor(private readonly port: number, private readonly token: string) {}

  health(): Promise<EngineHealth> {
    return request<EngineHealth>(this.port, this.token, 'GET', '/health');
  }

  getConfig(): Promise<unknown> {
    return request<unknown>(this.port, this.token, 'GET', '/config');
  }

  testConnection(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return request(this.port, this.token, 'POST', '/config/test');
  }

  listCrystals(): Promise<unknown[]> {
    return request<unknown[]>(this.port, this.token, 'GET', '/crystals');
  }

  syncCrystals(): Promise<{ success: boolean; message: string }> {
    return request(this.port, this.token, 'POST', '/crystals/sync');
  }

  docsStatus(repoPath: string): Promise<{ status: 'missing' | 'empty' | 'ready'; folderPath: string; repoPath: string }> {
    return request(this.port, this.token, 'GET', `/docs/status?repo=${encodeURIComponent(repoPath)}`);
  }

  setupDocs(repoPath: string): Promise<{ folderPath: string; created: boolean; status: 'missing' | 'empty' | 'ready' }> {
    return request(this.port, this.token, 'POST', '/docs/setup', { repoPath });
  }

  startAnalysis(repoPath: string, outputDir?: string): Promise<EngineJobResponse> {
    return request<EngineJobResponse>(this.port, this.token, 'POST', '/analyze', { repoPath, outputDir });
  }

  getJob(jobId: string): Promise<unknown> {
    return request<unknown>(this.port, this.token, 'GET', `/jobs/${jobId}`);
  }

  pollJob(
    jobId: string,
    onProgress: (job: unknown) => void,
    intervalMs = 800,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const poll = () => {
        this.getJob(jobId).then(job => {
          const j = job as { progress?: { status?: string }; error?: string };
          onProgress(job);
          const status = j.progress?.status ?? '';
          if (status === 'complete') { resolve(job); return; }
          if (status === 'failed') { reject(new Error(j.error ?? 'Analysis failed')); return; }
          setTimeout(poll, intervalMs);
        }).catch(reject);
      };
      poll();
    });
  }
}

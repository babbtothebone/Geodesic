import * as http from 'http';

export interface EngineHealth { ok: boolean; version: string }
export interface EngineJobResponse { jobId: string; status: string }

function request<T>(port: number, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
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
  constructor(private readonly port: number) {}

  health(): Promise<EngineHealth> {
    return request<EngineHealth>(this.port, 'GET', '/health');
  }

  getConfig(): Promise<unknown> {
    return request<unknown>(this.port, 'GET', '/config');
  }

  testConnection(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return request(this.port, 'POST', '/config/test');
  }

  listCrystals(): Promise<unknown[]> {
    return request<unknown[]>(this.port, 'GET', '/crystals');
  }

  syncCrystals(): Promise<{ success: boolean; message: string }> {
    return request(this.port, 'POST', '/crystals/sync');
  }

  docsStatus(repoPath: string): Promise<{ status: 'missing' | 'empty' | 'ready'; folderPath: string; repoPath: string }> {
    return request(this.port, 'GET', `/docs/status?repo=${encodeURIComponent(repoPath)}`);
  }

  setupDocs(repoPath: string): Promise<{ folderPath: string; created: boolean; status: 'missing' | 'empty' | 'ready' }> {
    return request(this.port, 'POST', '/docs/setup', { repoPath });
  }

  startAnalysis(repoPath: string, outputDir?: string): Promise<EngineJobResponse> {
    return request<EngineJobResponse>(this.port, 'POST', '/analyze', { repoPath, outputDir });
  }

  getJob(jobId: string): Promise<unknown> {
    return request<unknown>(this.port, 'GET', `/jobs/${jobId}`);
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

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createServer } from './http-server.js';
import { GEODESIC_VERSION } from '../version.js';

function writeCrashLog(reason: unknown, origin: string): void {
  try {
    const dir = path.join(os.homedir(), '.geodesic');
    fs.mkdirSync(dir, { recursive: true });
    const entry = [
      `timestamp: ${new Date().toISOString()}`,
      `geodesic: ${GEODESIC_VERSION}`,
      `node: ${process.version}`,
      `origin: ${origin}`,
      `error: ${reason instanceof Error ? reason.message : String(reason)}`,
      reason instanceof Error && reason.stack ? `stack:\n${reason.stack}` : '',
      '---',
    ].filter(Boolean).join('\n');
    fs.appendFileSync(path.join(dir, 'engine-crash.log'), entry + '\n\n', 'utf8');
  } catch { /* non-fatal */ }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      const port = addr.port;
      srv.close(() => { resolve(port); });
    });
    srv.on('error', reject);
  });
}

async function main(): Promise<void> {
  const port = await findFreePort();
  const server = createServer(GEODESIC_VERSION);

  server.listen(port, '127.0.0.1', () => {
    // Write port to stdout so engine manager can capture it
    process.stdout.write(`GEODE_ENGINE_PORT=${String(port)}\n`);
  });

  server.on('error', (err) => {
    process.stderr.write(`Engine server error: ${err.message}\n`);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => { server.close(() => { process.exit(0); }); });
  process.on('SIGINT',  () => { server.close(() => { process.exit(0); }); });

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[geodesic] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}\n`);
    writeCrashLog(reason, 'unhandledRejection');
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    process.stderr.write(`[geodesic] uncaught exception: ${err.stack ?? err.message}\n`);
    writeCrashLog(err, 'uncaughtException');
    process.exit(1);
  });
}

void main();

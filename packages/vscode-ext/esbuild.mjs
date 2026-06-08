import * as esbuild from 'esbuild';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: !production ? 'inline' : false,
  minify: production,
  logLevel: 'info',
};

// 1. Bundle the VS Code extension (entry: src/extension.ts)
await esbuild.build({
  ...sharedOptions,
  entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
  outfile: path.join(__dirname, 'dist', 'bundle.js'),
  external: ['vscode'],   // vscode is provided by the VS Code runtime at execution time
  format: 'cjs',
});

// 2. Bundle the Geode engine server (entry: ../engine/src/server/start.ts)
//    This file is spawned as a child process by engine-manager.ts.
//    Bundling it here means the VSIX ships a self-contained engine — no npm install needed.
await esbuild.build({
  ...sharedOptions,
  entryPoints: [path.join(__dirname, '..', 'engine', 'src', 'server', 'start.ts')],
  outfile: path.join(__dirname, 'dist', 'engine-start.js'),
  format: 'cjs',
  // Node.js built-ins are automatically external when platform='node'
});

console.log(`\nBuild complete. Production: ${String(production)}`);

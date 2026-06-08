import * as path from 'path';
import * as fs from 'fs';
import type { Command } from 'commander';
import { harvest } from '@geodesic/engine';

/* eslint-disable no-console */
export function registerHarvestCommand(program: Command): void {
  program
    .command('harvest [repoPath]')
    .description('Statically analyse a repository and output the harvest result')
    .option('-o, --output <file>', 'Write JSON output to file instead of stdout')
    .option('--pretty', 'Pretty-print JSON output', false)
    .action((repoPathArg: string | undefined, opts: { output?: string; pretty: boolean }) => {
      const repoPath = path.resolve(repoPathArg ?? '.');

      if (!fs.existsSync(repoPath)) {
        console.error(`error: path does not exist: ${repoPath}`);
        process.exit(1);
      }

      const stat = fs.statSync(repoPath);
      if (!stat.isDirectory()) {
        console.error(`error: path is not a directory: ${repoPath}`);
        process.exit(1);
      }

      console.error(`[geodesic] harvesting ${repoPath} ...`);
      const result = harvest(repoPath);
      console.error(
        '[geodesic] done in ' + String(result.meta.harvestDurationMs) + 'ms — ' +
        String(result.meta.totalFiles) + ' files, ' +
        String(result.apiRoutes.length) + ' routes, ' +
        String(result.piiCandidateLocations.length) + ' PII candidates',
      );

      const json = opts.pretty
        ? JSON.stringify(result, null, 2)
        : JSON.stringify(result);

      if (opts.output) {
        const outPath = path.resolve(opts.output);
        fs.writeFileSync(outPath, json, 'utf-8');
        console.error(`[geodesic] result written to ${outPath}`);
      } else {
        process.stdout.write(json + '\n');
      }
    });
}
/* eslint-enable no-console */

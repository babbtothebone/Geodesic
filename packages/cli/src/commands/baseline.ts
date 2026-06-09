import * as path from 'path';
import * as fs from 'fs';
import type { Command } from 'commander';
import type { HarvestResult } from '@geodesic/types';
import {
  harvest,
  loadBaselineFile,
  validateBaseline,
  detectDrift,
  writeDriftReport,
  BaselineLoadError,
} from '@geodesic/engine';

/* eslint-disable no-console */

interface DiffOptions {
  output?: string;
}

export function registerBaselineCommand(program: Command): void {
  const baseline = program
    .command('baseline')
    .description('Work with architectural baselines for drift detection');

  baseline
    .command('validate <path>')
    .description('Validate a baseline JSON file against the schema')
    .action((filePath: string) => {
      const abs = path.resolve(filePath);
      if (!fs.existsSync(abs)) {
        console.error(`[geodesic] baseline: file not found: ${abs}`);
        process.exit(2);
      }
      try {
        const raw = fs.readFileSync(abs, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const b = validateBaseline(parsed, abs);
        console.log(
          `[geodesic] ✓ baseline valid — "${b.name}" (schema ${b.schemaVersion}): ` +
            `${String(b.components.length)} components, ${String(b.databases.length)} databases, ` +
            `${String(b.apiRoutes.length)} routes, ${String(b.containers.length)} containers, ` +
            `${String(b.storage.length)} storage, ${String(b.edges.length)} edges`,
        );
        process.exit(0);
      } catch (err) {
        if (err instanceof BaselineLoadError) {
          console.error(`[geodesic] ✗ ${err.message}`);
        } else {
          console.error(`[geodesic] ✗ baseline: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    });

  baseline
    .command('diff <baselinePath> <repoPath>')
    .description('Compare a baseline against a freshly harvested repo (no LLM call)')
    .option('-o, --output <dir>', 'Directory to write DRIFT-REPORT.md and drift-report.json')
    .action((baselinePath: string, repoPath: string, opts: DiffOptions) => {
      const blAbs = path.resolve(baselinePath);
      const repoAbs = path.resolve(repoPath);
      if (!fs.existsSync(blAbs)) {
        console.error(`[geodesic] baseline: file not found: ${blAbs}`);
        process.exit(2);
      }
      if (!fs.existsSync(repoAbs) || !fs.statSync(repoAbs).isDirectory()) {
        console.error(`[geodesic] baseline: repo path is not a directory: ${repoAbs}`);
        process.exit(2);
      }

      let bl: ReturnType<typeof loadBaselineFile>;
      try {
        bl = loadBaselineFile(blAbs);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
        return;
      }

      console.log(`[geodesic] harvesting ${repoAbs}…`);
      const h: HarvestResult = harvest(repoAbs);
      console.log(`[geodesic]   ${String(h.meta.totalFiles)} files, ${String(h.apiRoutes.length)} routes`);

      const report = detectDrift(bl, h);
      console.log(
        `[geodesic] drift: ${String(report.counts.total)} findings ` +
          `(P0: ${String(report.counts.p0)} · P1: ${String(report.counts.p1)} · P2: ${String(report.counts.p2)})`,
      );

      if (opts.output) {
        const outDir = path.resolve(opts.output);
        const { mdPath, jsonPath } = writeDriftReport(outDir, report);
        console.log(`[geodesic]   → ${mdPath}`);
        console.log(`[geodesic]   → ${jsonPath}`);
      } else {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      }

      // Non-zero exit when P0 drift exists — useful in CI
      process.exit(report.counts.p0 > 0 ? 3 : 0);
    });
}

/* eslint-enable no-console */

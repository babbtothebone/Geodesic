import * as path from 'path';
import * as fs from 'fs';
import type { Command } from 'commander';
import { verifyChainFile } from '@geodesic/engine';

/* eslint-disable no-console */

interface VerifyOptions {
  quiet?: boolean;
}

export function registerAttestCommand(program: Command): void {
  const attest = program
    .command('attest')
    .description('Inspect and verify Geodesic attestation chains');

  attest
    .command('verify <path>')
    .description('Verify a SHA-256-chained JSONL attestation file (PII or datasource)')
    .option('-q, --quiet', 'Suppress per-record output; print only the final status')
    .action((filePath: string, opts: VerifyOptions) => {
      const abs = path.resolve(filePath);
      if (!fs.existsSync(abs)) {
        console.error(`[geodesic] attest: file not found: ${abs}`);
        process.exit(2);
      }
      const result = verifyChainFile(abs);
      if (!opts.quiet) {
        console.log(`[geodesic] attest: ${abs}`);
        console.log(`[geodesic]   records checked: ${String(result.recordsChecked)}`);
      }
      if (result.ok) {
        console.log(`[geodesic] ✓ chain verified (${String(result.recordsChecked)} records)`);
        process.exit(0);
      } else {
        console.error(
          `[geodesic] ✗ chain BROKEN at seq=${String(result.firstBrokenSeq ?? '?')}: ${result.reason ?? 'unknown'}`,
        );
        process.exit(1);
      }
    });
}

/* eslint-enable no-console */

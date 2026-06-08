import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { Command } from 'commander';
import type { GeodesicConfig, HarvestResult } from '@geodesic/types';
import {
  GEODESIC_VERSION,
  harvest,
  intercept,
  loadConfig,
  loadProvider,
  loadEchoProvider,
  synthesize,
  writeArtifacts,
  computeFingerprint,
  getCrystalsDir,
  CrystalStore,
  queryCrystal,
  pullCrystals,
  pushCrystals,
  extractCrystal,
} from '@geodesic/engine';

/* eslint-disable no-console */

interface AnalyzeOptions {
  output?: string;
  provider?: string;
  crystalSync: boolean; // commander flips --no-crystal-sync → crystalSync=false
  config?: string;
}

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze <path> [paths...]')
    .description('Run full Geodesic analysis on one or more repositories')
    .option('-o, --output <dir>', 'Custom output directory (overrides config)')
    .option('--provider <name>', 'Override the configured AI provider')
    .option('--no-crystal-sync', 'Skip GitHub Crystal sync (air-gapped environments)')
    .option('--config <path>', 'Path to config file (default: ~/.geodesic/config.json)')
    .action(async (firstPath: string, morePaths: string[], opts: AnalyzeOptions) => {
      const repoPaths = [firstPath, ...morePaths].map(p => path.resolve(p));

      for (const p of repoPaths) {
        if (!fs.existsSync(p)) {
          console.error(`[geodesic] error: path does not exist: ${p}`);
          process.exit(1);
        }
        if (!fs.statSync(p).isDirectory()) {
          console.error(`[geodesic] error: path is not a directory: ${p}`);
          process.exit(1);
        }
      }

      let config: GeodesicConfig;
      try {
        config = loadConfig(opts.config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[geodesic] config error: ${msg}`);
        process.exit(2);
        return;
      }

      if (opts.provider) {
        config = { ...config, provider: opts.provider as GeodesicConfig['provider'] };
      }
      if (!opts.crystalSync) {
        config = { ...config, advanced: { ...config.advanced, noCrystalSync: true } };
      }

      const partialOutputDirs: string[] = [];

      function cleanupAndExit(signal: string): void {
        if (partialOutputDirs.length > 0) {
          console.error(`\n[geodesic] ${signal} received — removing partial artifacts…`);
          for (const dir of partialOutputDirs) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
            console.error(`[geodesic]   removed: ${dir}`);
          }
        }
        process.exit(130);
      }

      process.once('SIGINT', () => { cleanupAndExit('SIGINT'); });
      process.once('SIGTERM', () => { cleanupAndExit('SIGTERM'); });

      let allSuccess = true;
      for (const repoPath of repoPaths) {
        const outputDir = opts.output
          ? path.resolve(opts.output, path.basename(repoPath))
          : (config.outputDir ?? path.join(repoPath, 'geodesic-findings'));
        partialOutputDirs.push(outputDir);
        const ok = await analyzeRepo(repoPath, config, opts.output);
        if (ok) partialOutputDirs.splice(partialOutputDirs.indexOf(outputDir), 1);
        else allSuccess = false;
      }

      process.exit(allSuccess ? 0 : 1);
    });
}

function writeErrorLog(outputDir: string, stage: string, err: unknown): string {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const logPath = path.join(outputDir, 'geodesic-error.log');
    const entry = [
      `timestamp: ${new Date().toISOString()}`,
      `geodesic: ${GEODESIC_VERSION}`,
      `node: ${process.version}`,
      `platform: ${process.platform}`,
      `stage: ${stage}`,
      `error: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error && err.stack ? `stack:\n${err.stack}` : '',
      '---',
    ].filter(Boolean).join('\n');
    fs.appendFileSync(logPath, entry + '\n\n', 'utf8');
    return logPath;
  } catch {
    return '(could not write error log)';
  }
}

async function analyzeRepo(
  repoPath: string,
  config: GeodesicConfig,
  outputDirOverride: string | undefined,
): Promise<boolean> {
  const repoName = path.basename(repoPath);
  const outputDir = outputDirOverride
    ? path.resolve(outputDirOverride, repoName)
    : (config.outputDir ?? path.join(repoPath, 'geodesic-findings'));

  // Protect geodesic-findings from being accidentally committed
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const gitignorePath = path.join(outputDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(
        gitignorePath,
        '# Geodesic analysis artifacts — machine-generated, do not commit\n*\n!.gitignore\n',
        'utf8',
      );
    }
  } catch { /* non-fatal */ }

  console.log(`\n[geodesic] ── Analyzing ${repoName} ──`);
  console.log(`[geodesic] repo:     ${repoPath}`);
  console.log(`[geodesic] output:   ${outputDir}`);
  console.log(`[geodesic] provider: ${config.provider}`);

  try {
    // Stage 1: Harvest
    console.log('[geodesic] stage 1/6: harvesting…');
    const harvestResult: HarvestResult = harvest(repoPath);
    console.log(
      `[geodesic]   ${String(harvestResult.meta.totalFiles)} files, ` +
      `${String(harvestResult.apiRoutes.length)} routes, ` +
      `${String(harvestResult.meta.harvestDurationMs)}ms`,
    );

    // Stage 2: PII/HIPAA intercept
    console.log('[geodesic] stage 2/6: scrubbing PII/PHI…');
    const interceptResult = intercept(harvestResult, {
      analystId: config.analystId,
      repo: repoName,
      repoCommit: harvestResult.meta.repoCommit ?? 'unknown',
    });
    console.log(
      `[geodesic]   PHI: ${String(interceptResult.phiCount)}, ` +
      `PII: ${String(interceptResult.piiCount)}, ` +
      `secrets: ${String(interceptResult.secretCount)}`,
    );
    if (interceptResult.uncertainDetections.length > 0) {
      console.log(`[geodesic]   uncertain: ${String(interceptResult.uncertainDetections.length)} (review gap report)`);
    }

    // Write compliance artifact immediately — stored outside the analyzed repo, never committed
    if (interceptResult.attestationEntries.length > 0) {
      try {
        const attestationTs = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const attestationDir = path.join(os.homedir(), '.geodesic', 'attestations');
        const attestationPath = path.join(attestationDir, `${repoName}-${attestationTs}.jsonl`);
        fs.mkdirSync(attestationDir, { recursive: true });
        const lines = interceptResult.attestationEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(attestationPath, lines, 'utf8');
        console.log(`[geodesic]   attestation → ${attestationPath}`);
      } catch (attErr) {
        console.error(`[geodesic]   warn: could not write attestation chain: ${attErr instanceof Error ? attErr.message : String(attErr)}`);
      }
    }

    // intercept() mutated harvestResult in place; scrubbedHarvest is the same object reference.
    const scrubbedHarvest = interceptResult.scrubbedHarvest;

    // Stage 3: Crystal query
    console.log('[geodesic] stage 3/6: querying Crystal Store…');
    const fingerprint = computeFingerprint(harvestResult);
    const crystalsDir = getCrystalsDir(undefined);
    const store = new CrystalStore(crystalsDir);

    if (!config.advanced?.noCrystalSync) {
      const syncResult = await pullCrystals(crystalsDir, config);
      if (syncResult.message) {
        console.log(`[geodesic]   sync: ${syncResult.message}`);
      }
    }

    const queryResult = queryCrystal(fingerprint, store.getAll());
    if (queryResult.crystal) {
      console.log(
        `[geodesic]   crystal hit: ${fingerprint} ` +
        `(${String(Math.round(queryResult.matchScore * 100))}% match)`,
      );
    } else {
      console.log('[geodesic]   no crystal match — cold-start analysis');
    }

    // Stage 4: AI synthesis
    console.log(`[geodesic] stage 4/6: synthesizing with ${config.provider}…`);
    const provider = await loadProvider(config);
    const echoProvider = await loadEchoProvider(config);

    const synthesis = await synthesize({
      harvest: scrubbedHarvest,
      crystal: queryResult.crystal,
      crystalMatchScore: queryResult.matchScore > 0 ? queryResult.matchScore : null,
      provider,
      echoProvider,
      analystId: config.analystId,
      repo: repoName,
      repoCommit: harvestResult.meta.repoCommit ?? 'unknown',
      onWarning: (msg) => { console.log(`[geodesic]   ⚠ ${msg}`); },
    });

    console.log(
      `[geodesic]   tokens: ${String(synthesis.synthesisTokensUsed)}, ` +
      `duration: ${String(synthesis.skillFile.meta.analysisDurationMs)}ms`,
    );

    // Stage 5: Write artifacts
    console.log('[geodesic] stage 5/6: writing artifacts…');
    const artifactPaths = writeArtifacts(synthesis, outputDir);
    console.log(`[geodesic]   architecture-map → ${artifactPaths.architectureMap}`);
    console.log(`[geodesic]   skill-file.json  → ${artifactPaths.skillFileJson}`);
    console.log(`[geodesic]   skill-file.md    → ${artifactPaths.skillFileMd}`);
    console.log(`[geodesic]   gap-report       → ${artifactPaths.gapReport}`);

    // Stage 6: Crystal extraction
    console.log('[geodesic] stage 6/6: extracting crystal…');
    const extraction = extractCrystal({
      fingerprint,
      existing: queryResult.crystal,
      synthesis,
    });

    if (extraction.purityPassed) {
      store.write(extraction.crystal);
      const statusLabel = extraction.crystal.status === 'active' ? 'promoted' : 'saved (probation)';
      console.log(`[geodesic]   crystal ${statusLabel}: ${fingerprint}`);
      if (!config.advanced?.noCrystalSync) {
        const pushResult = await pushCrystals(crystalsDir, extraction.crystal, config);
        if (!pushResult.success) {
          console.error(`[geodesic]   crystal push: ${pushResult.message}`);
        }
      }
    } else {
      console.log(
        `[geodesic]   crystal skipped (purity failure): ${extraction.purityFailReason ?? 'purity check failed'}`,
      );
    }

    // Summary
    const gr = synthesis.gapReport;
    console.log(`\n[geodesic] ✓ ${repoName} — ${String(gr.overallScore)}/100 (${gr.overallGrade})`);
    if (gr.dimensions.length > 0) {
      for (const dim of gr.dimensions) {
        if (dim.active) {
          console.log(`[geodesic]   ${dim.dimension.padEnd(16)} ${dim.grade}  ${String(dim.score)}/100`);
        }
      }
    }
    if (gr.uncertainDetections.length > 0) {
      console.log(
        `[geodesic]   ⚠ ${String(gr.uncertainDetections.length)} uncertain PII detection(s) — review gap report`,
      );
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[geodesic] error: ${msg}`);
    const logPath = writeErrorLog(outputDir, 'analysis', err);
    console.error(`[geodesic] error log: ${logPath}`);
    return false;
  }
}

/* eslint-enable no-console */

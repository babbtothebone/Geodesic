import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { HarvestResult, GeodesicConfig, PhaseProgressEvent } from '@geodesic/types';
import { harvest } from '../harvester/index.js';
import { intercept } from '../intercept/index.js';
import { loadProvider, loadEchoProvider } from '../providers/index.js';
import { writeArtifacts } from '../artifacts/index.js';
import {
  buildDatasourceAttestation,
  writeDatasourceAttestation,
} from '../harvester/datasource-attestation.js';
import { buildDataLineage, writeDataLineage } from '../artifacts/data-lineage.js';
import { loadBaselineFile, detectDrift, writeDriftReport, BaselineLoadError } from '../baseline/index.js';
import {
  computeFingerprint,
  queryCrystal,
  CrystalStore,
  getCrystalsDir,
  extractCrystal,
  pullCrystals,
  pushCrystals,
} from '../crystal/index.js';
import { synthesize, OVERALL_ANALYSIS_TIMEOUT_MS } from '../synthesis/index.js';
import { collectIngestedDocs } from '../docs/index.js';
import { GEODESIC_VERSION } from '../version.js';
import {
  createJob,
  updateJobProgress,
  completeJob,
  failJob,
  startPhase,
  completePhase,
  failPhase,
  setPhaseBadge,
  addSubtask,
  addPendingSubtask,
  startSubtask,
  completeSubtask,
  type AnalysisJob,
  type JobResult,
} from './jobs.js';

function writeErrorLog(outputDir: string, stage: string, err: unknown): void {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
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
    fs.appendFileSync(path.join(outputDir, 'geodesic-error.log'), entry + '\n\n', 'utf8');
  } catch { /* non-fatal */ }
}

function writeAttestationChain(attestationPath: string, entries: unknown[]): void {
  if (entries.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(attestationPath), { recursive: true });
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(attestationPath, lines, 'utf8');
  } catch (err) {
    process.stderr.write(`[geodesic] warn: could not write attestation chain: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export interface PipelineOptions {
  repoPath: string;
  config: GeodesicConfig;
  outputDir?: string;
}

export function startPipeline(opts: PipelineOptions): AnalysisJob {
  const job = createJob(opts.repoPath);
  const hardCapTimer = setTimeout(() => {
    failJob(job.id, `Analysis exceeded ${String(Math.round(OVERALL_ANALYSIS_TIMEOUT_MS / 60_000))} min hard cap — job aborted. See geodesic-error.log.`);
  }, OVERALL_ANALYSIS_TIMEOUT_MS);
  void runPipeline(job.id, opts).finally(() => { clearTimeout(hardCapTimer); });
  return job;
}

async function runPipeline(jobId: string, opts: PipelineOptions): Promise<void> {
  const { repoPath, config } = opts;
  const repoName = path.basename(repoPath);
  const outputDir = opts.outputDir
    ?? config.outputDir
    ?? path.join(repoPath, 'geodesic-findings');

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
  } catch { /* non-fatal — downstream writes will retry mkdirSync */ }

  try {
    // ─── Phase 1: Harvest ──────────────────────────────────────────────────
    updateJobProgress(jobId, { status: 'harvesting', stage: 'Building file catalog…' });
    startPhase(jobId, 'harvest');

    const onHarvestProgress = (event: PhaseProgressEvent): void => {
      if (event.type === 'phase_start') {
        updateJobProgress(jobId, { stage: event.message });
      } else if (event.type === 'phase_complete') {
        updateJobProgress(jobId, { stage: event.message });
        addSubtask(jobId, 'harvest', event.message);
      } else if (event.type === 'discovery_finding') {
        addSubtask(jobId, 'harvest', event.message);
      } else if (event.type === 'file_error') {
        writeErrorLog(outputDir, 'harvest-file-error', new Error(event.message));
      } else if (event.type === 'warning') {
        updateJobProgress(jobId, { stage: `⚠ ${event.message}` });
        writeErrorLog(outputDir, 'harvest-warning', new Error(event.message));
      }
    };

    const harvestResult: HarvestResult = harvest(repoPath, onHarvestProgress);
    completePhase(jobId, 'harvest', `${String(harvestResult.meta.totalFiles)} files`);

    // ─── Phase 2: PII/HIPAA Intercept ──────────────────────────────────────
    updateJobProgress(jobId, { status: 'scrubbing', stage: 'PII/HIPAA intercept running…' });
    startPhase(jobId, 'scrub');

    const interceptResult = intercept(harvestResult, {
      analystId: config.analystId,
      repo: repoName,
      repoCommit: harvestResult.meta.repoCommit ?? 'unknown',
    });

    const attestationTs = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const attestationDir = path.join(os.homedir(), '.geodesic', 'attestations');
    const attestationPath = path.join(attestationDir, `${repoName}-${attestationTs}.jsonl`);
    writeAttestationChain(attestationPath, interceptResult.attestationEntries);

    // ─── Datasource attestation ──────────────────────────────────────────
    // SHA-256-chained JSONL covering every discovered DB, schema file, API
    // route, env-connection, and exposed sink. Lives next to the audit
    // output so it ships with the GAP-REPORT for review.
    try {
      const dsRecords = buildDatasourceAttestation(harvestResult, {
        repo: repoName,
        repoCommit: harvestResult.meta.repoCommit ?? 'unknown',
        runId: jobId,
      });
      const dsPath = path.join(outputDir, 'datasource-attestation.jsonl');
      const dsSummary = writeDatasourceAttestation(dsPath, dsRecords);
      addSubtask(
        jobId, 'scrub',
        `Datasource attestation · ${String(dsSummary.recordCount)} records` +
          (dsSummary.tipHash ? ` · tip ${dsSummary.tipHash.slice(0, 14)}…` : ''),
        dsPath,
      );
    } catch (err) {
      writeErrorLog(outputDir, 'datasource-attestation', err);
    }

    // Intercept mutated the original harvest in place — `scrubbedHarvest` is the same object,
    // now containing attestation tokens.
    const scrubbedHarvest = interceptResult.scrubbedHarvest;

    const scrubSummary = `${String(interceptResult.phiCount)} PHI · ${String(interceptResult.piiCount)} PII · ${String(interceptResult.secretCount)} secrets scrubbed`;
    addSubtask(jobId, 'scrub', scrubSummary);
    addSubtask(jobId, 'scrub', `Attestation anchored · ${interceptResult.payloadHash.slice(0, 14)}…`);
    addSubtask(jobId, 'scrub', 'Purity verified');
    updateJobProgress(jobId, { phiZoneCount: interceptResult.phiCount, stage: scrubSummary });
    completePhase(jobId, 'scrub');

    // ─── Phase 3: Crystal Query ────────────────────────────────────────────
    updateJobProgress(jobId, { status: 'querying-crystal', stage: 'Querying Crystal Store…' });
    startPhase(jobId, 'crystal-query');

    const fingerprint = computeFingerprint(harvestResult);
    const crystalsDir = getCrystalsDir(undefined);
    const store = new CrystalStore(crystalsDir);

    if (!(config.advanced?.noCrystalSync)) {
      const syncResult = await pullCrystals(crystalsDir, config);
      if (!syncResult.success) {
        process.stderr.write(`[geodesic] crystal sync: ${syncResult.message}\n`);
      }
    }

    const queryResult = queryCrystal(fingerprint, store.getAll());
    const crystalMatch = queryResult.matchType === 'exact' ? 'hit'
      : queryResult.matchType === 'fuzzy' ? 'hit'
      : 'cold-start';

    const crystalSummary = queryResult.crystal
      ? `Crystal hit · ${String(Math.round(queryResult.matchScore * 100))}% match — prior analysis pre-loaded`
      : 'Cold start — building from scratch';
    addSubtask(jobId, 'crystal-query', crystalSummary);
    updateJobProgress(jobId, {
      crystalMatch,
      crystalMatchScore: queryResult.matchScore > 0 ? queryResult.matchScore : null,
      stage: crystalSummary,
    });
    completePhase(jobId, 'crystal-query', queryResult.crystal ? 'hit' : 'cold start');

    // ─── Phases 4–6: AI Synthesis (discovery, deep dives, artifacts) ───────
    updateJobProgress(jobId, { status: 'synthesizing', stage: 'AI synthesis starting…' });
    const provider = await loadProvider(config);
    const echoProvider = await loadEchoProvider(config);

    // Collect transition docs dropped into <repo>/transition-docs/ (LLM-free).
    // Empty bundle → synthesis runs identically to before.
    let transitionDocsBundle = null;
    try {
      const bundle = collectIngestedDocs(repoPath);
      if (bundle.docs.length > 0 || bundle.knownGaps.length > 0) {
        transitionDocsBundle = bundle;
        addSubtask(
          jobId, 'crystal-query',
          `Transition docs · ${String(bundle.docs.length)} file(s)` +
            (bundle.knownGaps.length > 0 ? ` · ${String(bundle.knownGaps.length)} blind spot(s)` : ''),
          bundle.folderPath,
        );
      }
    } catch (err) {
      writeErrorLog(outputDir, 'docs-ingest', err);
    }

    const synthesis = await synthesize({
      harvest: scrubbedHarvest,
      crystal: queryResult.crystal,
      crystalMatchScore: queryResult.matchScore > 0 ? queryResult.matchScore : null,
      provider,
      echoProvider,
      analystId: config.analystId,
      repo: repoName,
      repoCommit: harvestResult.meta.repoCommit ?? 'unknown',
      onWarning: (msg) => {
        updateJobProgress(jobId, { stage: `⚠ ${msg}` });
        // Warnings are non-fatal — the job continues. Don't pollute geodesic-error.log.
      },
      onProgress: (msg) => {
        updateJobProgress(jobId, { stage: msg });
      },
      transitionDocs: transitionDocsBundle,
      onPhaseEvent: (event) => {
        // Synthesis emits structured events that map cleanly onto our phase tree.
        // See engine.ts for the contract.
        switch (event.type) {
          case 'discovery_started':
            startPhase(jobId, 'discovery');
            break;
          case 'discovery_complete':
            addSubtask(jobId, 'discovery', `${String(event.subsystemCount)} subsystems identified`, event.subsystemNames.join(', '));
            completePhase(jobId, 'discovery', `${String(event.subsystemCount)} subsystems`);
            // Pre-populate deep-dives with one pending subtask per subsystem so the
            // user can see all 8 lined up before any of them runs.
            startPhase(jobId, 'deep-dives');
            setPhaseBadge(jobId, 'deep-dives', `0/${String(event.subsystemCount)}`);
            for (const sub of event.subsystems) {
              addPendingSubtask(jobId, 'deep-dives', sub.id, sub.name);
            }
            break;
          case 'deep_dive_started':
            startSubtask(jobId, 'deep-dives', event.subsystemId);
            break;
          case 'deep_dive_complete':
            completeSubtask(jobId, 'deep-dives', event.subsystemId,
              event.status === 'shallow' ? 'fallback (raw harvest)' : undefined);
            setPhaseBadge(jobId, 'deep-dives', `${String(event.completed)}/${String(event.total)}`);
            break;
          case 'deep_dives_complete':
            completePhase(jobId, 'deep-dives', `${String(event.total)} subsystems`);
            startPhase(jobId, 'artifacts');
            // Three artifacts run in parallel — show them all so devs see the parallelism.
            addPendingSubtask(jobId, 'artifacts', 'arch-map',  'Architecture map');
            addPendingSubtask(jobId, 'artifacts', 'skill',     'Skill file');
            addPendingSubtask(jobId, 'artifacts', 'gap',       'Gap report');
            startSubtask(jobId, 'artifacts', 'arch-map');
            startSubtask(jobId, 'artifacts', 'skill');
            startSubtask(jobId, 'artifacts', 'gap');
            break;
          case 'artifacts_complete':
            completeSubtask(jobId, 'artifacts', 'arch-map');
            completeSubtask(jobId, 'artifacts', 'skill');
            completeSubtask(jobId, 'artifacts', 'gap');
            completePhase(jobId, 'artifacts');
            break;
        }
      },
    });

    // ─── Phase 7: Write artifacts to disk + Crystal Extraction ─────────────
    updateJobProgress(jobId, { status: 'writing', stage: 'Writing analysis artifacts…' });
    const artifactPaths = writeArtifacts(synthesis, outputDir);
    addSubtask(jobId, 'artifacts', `Written to ${path.basename(outputDir)}/`, outputDir);

    // ─── Data lineage map (JSON + Mermaid) ────────────────────────────────
    try {
      const lineage = buildDataLineage(harvestResult);
      const { jsonPath } = writeDataLineage(outputDir, lineage);
      addSubtask(
        jobId, 'artifacts',
        `Data lineage · ${String(lineage.nodes.length)} nodes · ${String(lineage.edges.length)} edges`,
        jsonPath,
      );
    } catch (err) {
      writeErrorLog(outputDir, 'data-lineage', err);
    }

    // ─── Drift detection (optional, baseline-driven) ─────────────────────
    if (config.baselinePath) {
      try {
        const baseline = loadBaselineFile(config.baselinePath);
        const driftReport = detectDrift(baseline, harvestResult);
        const { mdPath } = writeDriftReport(outputDir, driftReport);
        addSubtask(
          jobId, 'artifacts',
          `Drift report · ${String(driftReport.counts.total)} findings ` +
            `(P0: ${String(driftReport.counts.p0)} · P1: ${String(driftReport.counts.p1)} · P2: ${String(driftReport.counts.p2)})`,
          mdPath,
        );
      } catch (err) {
        if (err instanceof BaselineLoadError) {
          updateJobProgress(jobId, { stage: `⚠ baseline: ${err.message}` });
        }
        writeErrorLog(outputDir, 'drift-detection', err);
      }
    }

    startPhase(jobId, 'crystal-extraction');
    const extraction = extractCrystal({
      fingerprint,
      existing: queryResult.crystal,
      synthesis,
    });

    if (extraction.purityPassed) {
      store.write(extraction.crystal);
      addSubtask(jobId, 'crystal-extraction', 'Purity verified · Crystal written locally');
      if (!(config.advanced?.noCrystalSync)) {
        const pushResult = await pushCrystals(crystalsDir, extraction.crystal, config);
        if (pushResult.success) {
          addSubtask(jobId, 'crystal-extraction', 'Pushed to shared store');
        } else {
          addSubtask(jobId, 'crystal-extraction', `Push deferred: ${pushResult.message}`);
          process.stderr.write(`[geodesic] crystal push: ${pushResult.message}\n`);
        }
      }
      completePhase(jobId, 'crystal-extraction');
    } else {
      failPhase(jobId, 'crystal-extraction', 'purity failed');
    }

    // The architecture map is the only synthesis field that can come back empty — gapReport and
    // skillFile are guaranteed non-null by parseSynthesisResponse (assertGapReport throws on a bad
    // gap report, and the skill file is always assembled). A partial result is useless, so if the
    // map is missing we fail loudly and tell the user to retry.
    const missing: string[] = [];
    if (!synthesis.architectureMapMarkdown) missing.push('architecture map');
    if (missing.length > 0) {
      const msg = `Synthesis incomplete — AI failed to produce: ${missing.join(', ')}. Check your API quota and retry.`;
      writeErrorLog(outputDir, 'synthesis-incomplete', new Error(msg));
      failJob(jobId, msg);
      return;
    }

    const result: JobResult = {
      synthesis,
      artifactPaths,
      interceptStats: {
        phiCount: interceptResult.phiCount,
        piiCount: interceptResult.piiCount,
        secretCount: interceptResult.secretCount,
      },
      uncertainDetections: interceptResult.uncertainDetections,
      fingerprint,
    };

    completeJob(jobId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLog(outputDir, 'pipeline', err);
    failJob(jobId, `${message} — see geodesic-error.log in output directory`);
  }
}

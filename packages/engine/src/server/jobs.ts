import { randomUUID } from 'crypto';
import type { Phase, PhaseId, Subtask, SynthesisResult, UncertainDetection } from '@geodesic/types';
import type { ArtifactPaths } from '../artifacts/index.js';

// JobStatus is the legacy single-value status field. Retained alongside `phases` so
// the existing progress-bar mapping in the webview keeps working until it's replaced
// with a derived percentage from phase durations.
export type JobStatus =
  | 'queued'
  | 'harvesting'
  | 'scrubbing'
  | 'querying-crystal'
  | 'synthesizing'
  | 'writing'
  | 'complete'
  | 'failed';

export interface JobProgress {
  status: JobStatus;
  stage: string;
  phiZoneCount: number;
  crystalMatch: 'hit' | 'miss' | 'cold-start' | null;
  crystalMatchScore: number | null;
  // Hierarchical phase tree — the new authoritative source of progress detail.
  // The webview renders this directly. All seven phases are present from job
  // creation, in pending state, so the full shape of the run is always visible.
  phases: Phase[];
  startedAt: string;
}

export interface JobResult {
  synthesis: SynthesisResult;
  artifactPaths: ArtifactPaths;
  interceptStats: { phiCount: number; piiCount: number; secretCount: number };
  uncertainDetections: UncertainDetection[];
  fingerprint: string;
}

export interface AnalysisJob {
  id: string;
  repoPath: string;
  startedAt: string;
  progress: JobProgress;
  result: JobResult | null;
  error: string | null;
}

const jobs = new Map<string, AnalysisJob>();

const MAX_JOBS = 500;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - new Date(job.startedAt).getTime() > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.entries()].sort(
      (a, b) => new Date(a[1].startedAt).getTime() - new Date(b[1].startedAt).getTime(),
    );
    for (const [id] of sorted.slice(0, jobs.size - MAX_JOBS)) jobs.delete(id);
  }
}

// Canonical phase ordering. Matches the user-visible flow exactly.
const PHASE_ORDER: ReadonlyArray<{ id: PhaseId; name: string }> = [
  { id: 'harvest',             name: 'Harvest' },
  { id: 'scrub',               name: 'Scrub' },
  { id: 'crystal-query',       name: 'Crystal Query' },
  { id: 'discovery',           name: 'Discovery' },
  { id: 'deep-dives',          name: 'Deep Dives' },
  { id: 'artifacts',           name: 'Artifacts' },
  { id: 'crystal-extraction',  name: 'Crystal Extraction' },
];

function makeInitialPhases(): Phase[] {
  return PHASE_ORDER.map(({ id, name }) => ({
    id,
    name,
    status: 'pending',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    subtasks: [],
  }));
}

export function createJob(repoPath: string): AnalysisJob {
  pruneJobs();
  const id = randomUUID();
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id,
    repoPath,
    startedAt: now,
    progress: {
      status: 'queued',
      stage: 'Queued',
      phiZoneCount: 0,
      crystalMatch: null,
      crystalMatchScore: null,
      phases: makeInitialPhases(),
      startedAt: now,
    },
    result: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

// ─── Legacy helpers (kept for incremental migration) ──────────────────────────

export function updateJobProgress(id: string, progress: Partial<JobProgress>): void {
  const job = jobs.get(id);
  if (!job) return;
  job.progress = { ...job.progress, ...progress };
}

// ─── Phase transition helpers ─────────────────────────────────────────────────

function findPhase(job: AnalysisJob, phaseId: PhaseId): Phase | null {
  return job.progress.phases.find(p => p.id === phaseId) ?? null;
}

export function startPhase(jobId: string, phaseId: PhaseId): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  // Idempotent — re-starting an already-running phase is a no-op
  if (phase.status === 'running' || phase.status === 'complete') return;
  phase.status = 'running';
  phase.startedAt = new Date().toISOString();
}

export function completePhase(jobId: string, phaseId: PhaseId, badge?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  const now = new Date().toISOString();
  phase.status = 'complete';
  phase.completedAt = now;
  if (phase.startedAt) {
    phase.durationMs = new Date(now).getTime() - new Date(phase.startedAt).getTime();
  }
  if (badge !== undefined) phase.badge = badge;
}

export function failPhase(jobId: string, phaseId: PhaseId, badge?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  const now = new Date().toISOString();
  phase.status = 'failed';
  phase.completedAt = now;
  if (phase.startedAt) {
    phase.durationMs = new Date(now).getTime() - new Date(phase.startedAt).getTime();
  }
  if (badge !== undefined) phase.badge = badge;
}

export function skipPhase(jobId: string, phaseId: PhaseId, reason?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  phase.status = 'skipped';
  if (reason !== undefined) phase.badge = reason;
}

export function setPhaseBadge(jobId: string, phaseId: PhaseId, badge: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  phase.badge = badge;
}

// ─── Subtask helpers ──────────────────────────────────────────────────────────

// Append an atomic completed subtask (most common case — milestone records).
export function addSubtask(jobId: string, phaseId: PhaseId, label: string, detail?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  const now = new Date().toISOString();
  phase.subtasks.push({
    id: randomUUID(),
    label,
    status: 'complete',
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    detail,
  });
}

// Add a subtask in pending state. Used by deep-dives so all 8 subsystems show
// up-front as ⌛ queued, then transition to running and complete.
export function addPendingSubtask(jobId: string, phaseId: PhaseId, id: string, label: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  phase.subtasks.push({
    id,
    label,
    status: 'pending',
    startedAt: undefined,
    completedAt: undefined,
    durationMs: undefined,
  });
}

function findSubtask(phase: Phase, subtaskId: string): Subtask | null {
  return phase.subtasks.find(s => s.id === subtaskId) ?? null;
}

export function startSubtask(jobId: string, phaseId: PhaseId, subtaskId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  const sub = findSubtask(phase, subtaskId);
  if (!sub) return;
  sub.status = 'running';
  sub.startedAt = new Date().toISOString();
}

export function completeSubtask(jobId: string, phaseId: PhaseId, subtaskId: string, detail?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  const sub = findSubtask(phase, subtaskId);
  if (!sub) return;
  const now = new Date().toISOString();
  sub.status = 'complete';
  sub.completedAt = now;
  if (sub.startedAt) {
    sub.durationMs = new Date(now).getTime() - new Date(sub.startedAt).getTime();
  }
  if (detail !== undefined) sub.detail = detail;
}

export function failSubtask(jobId: string, phaseId: PhaseId, subtaskId: string, detail?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const phase = findPhase(job, phaseId);
  if (!phase) return;
  const sub = findSubtask(phase, subtaskId);
  if (!sub) return;
  const now = new Date().toISOString();
  sub.status = 'failed';
  sub.completedAt = now;
  if (sub.startedAt) {
    sub.durationMs = new Date(now).getTime() - new Date(sub.startedAt).getTime();
  }
  if (detail !== undefined) sub.detail = detail;
}

// ─── Job completion ───────────────────────────────────────────────────────────

export function completeJob(id: string, result: JobResult): void {
  const job = jobs.get(id);
  if (!job) return;
  job.result = result;
  job.progress.status = 'complete';
  job.progress.stage = 'Complete';
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.error = error;
  job.progress.status = 'failed';
  job.progress.stage = `Failed: ${error}`;
  // Mark any still-running phase as failed so the failure point is visible in the tree.
  for (const phase of job.progress.phases) {
    if (phase.status === 'running') {
      phase.status = 'failed';
      phase.completedAt = new Date().toISOString();
      if (phase.startedAt) {
        phase.durationMs = new Date(phase.completedAt).getTime() - new Date(phase.startedAt).getTime();
      }
    }
  }
}

export function getJob(id: string): AnalysisJob | null {
  return jobs.get(id) ?? null;
}

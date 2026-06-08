export type PhaseProgressEventType =
  | 'phase_start'
  | 'phase_complete'
  | 'file_cataloged'
  | 'file_read'
  | 'file_error'
  | 'pii_detected'
  | 'discovery_finding'
  | 'relationship_found'
  | 'synthesis_stage'
  | 'warning';

export interface PhaseProgressEvent {
  type: PhaseProgressEventType;
  phase: 1 | 2 | 3 | 4;
  message: string;
  detail?: string | undefined;
  filePath?: string | undefined;
  count?: number | undefined;
  total?: number | undefined;
}

// ─── Hierarchical Job Phase Model ──────────────────────────────────────────────
//
// A scan progresses through seven explicit top-level phases. Each is visible from
// the moment the job is created (in `pending` state), so devs always see the full
// shape of the run, not just the next-up step.
//
// Within a phase, individual milestones are tracked as `Subtask` entries. For most
// phases subtasks are completion records ("File catalog · 5,231 files · 47 symlinks").
// For the deep-dive phase, each subsystem becomes a subtask with its own status —
// concurrent work shows multiple `running` subtasks at once, faithfully reflecting
// the engine's actual concurrency.

export type PhaseId =
  | 'harvest'
  | 'scrub'
  | 'crystal-query'
  | 'discovery'
  | 'deep-dives'
  | 'artifacts'
  | 'crystal-extraction';

export type PhaseStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface Subtask {
  // Stable identifier used for in-place updates (e.g. a deep-dive subtask transitions
  // from running → complete without losing its slot in the list).
  id: string;
  label: string;
  status: PhaseStatus;
  // Optional ISO timestamps. Only set for subtasks that need duration tracking
  // (deep dives). Most subtasks are atomic completion records and leave these unset.
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  durationMs?: number | undefined;
  // Free-form short detail rendered next to the label (e.g. token count, file count).
  detail?: string | undefined;
}

export interface Phase {
  id: PhaseId;
  name: string;
  status: PhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  subtasks: Subtask[];
  // Optional metadata badges shown on the phase header (e.g. "(2/8)" for in-flight
  // deep dives, "(8 subsystems)" once complete). Plain strings — formatting lives
  // in the renderer.
  badge?: string | undefined;
}

import type { UncertainDetection, UncertainDetectionReport } from '@geodesic/types';

/**
 * Map scrubber-authoritative `UncertainDetection` rows into the `UncertainDetectionReport`
 * shape expected by the gap-report writer.
 *
 * Single source of truth for this mapping. Both the engine HTTP pipeline
 * (`packages/engine/src/server/pipeline.ts`) and the standalone CLI orchestrator
 * (`packages/cli/src/commands/analyze.ts`) call this helper right before
 * `writeArtifacts()` so the rendered gap report always reflects the scrubber's
 * authoritative detection list — never whatever the AI model invented in its
 * `uncertainDetections` JSON field.
 *
 * The two types differ only in one field name (`recommendedAction` → `action`)
 * and the report shape omits the scrubber's `reviewedAt` / `reviewedBy` audit
 * fields (those live in the attestation chain, not in user-facing output).
 */
export function uncertainDetectionsToReport(
  detections: ReadonlyArray<UncertainDetection>,
): UncertainDetectionReport[] {
  return detections.map(d => ({
    entryId: d.entryId,
    file: d.file,
    lineStart: d.lineStart,
    lineEnd: d.lineEnd,
    isApproximateRange: d.isApproximateRange,
    trigger: d.trigger,
    confidencePct: d.confidencePct,
    confidence: d.confidence,
    attestationRef: d.attestationRef,
    action: d.recommendedAction,
    markedReviewed: d.markedReviewed,
  }));
}

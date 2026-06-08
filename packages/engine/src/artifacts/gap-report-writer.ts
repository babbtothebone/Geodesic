import type {
  GapReport,
  GapFinding,
  DimensionScore,
  FindingSeverity,
  UncertainDetectionReport,
  LetterGrade,
} from '@geodesic/types';

function gradeLabel(grade: LetterGrade): string {
  const labels: Record<LetterGrade, string> = {
    A: 'A (Production Ready)',
    B: 'B (Minor Gaps)',
    C: 'C (Significant Gaps)',
    D: 'D (Critical Gaps)',
    F: 'F (Blocked)',
  };
  return labels[grade];
}

function findingCountLabel(findings: GapFinding[]): string {
  const counts: Record<FindingSeverity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  const parts: string[] = [];
  if (counts.P0 > 0) parts.push(`${String(counts.P0)} P0`);
  if (counts.P1 > 0) parts.push(`${String(counts.P1)} P1`);
  if (counts.P2 > 0) parts.push(`${String(counts.P2)} P2`);
  if (counts.P3 > 0) parts.push(`${String(counts.P3)} P3`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function renderFinding(f: GapFinding): string[] {
  const lines: string[] = [];
  lines.push(`**[${f.severity}] ${f.description}**`);
  const lineRange = f.lineStart === f.lineEnd
    ? String(f.lineStart)
    : `${String(f.lineStart)}–${String(f.lineEnd)}`;
  lines.push(`- File: \`${f.file}\` — Lines ${lineRange}`);
  lines.push(`- Detail: ${f.detail}`);
  lines.push(`- Fix: ${f.fix}`);
  lines.push('');
  return lines;
}

function renderUncertainDetection(det: UncertainDetectionReport, index: number): string[] {
  const lines: string[] = [];
  const lineRange = det.isApproximateRange
    ? `${String(det.lineStart)}–${String(det.lineEnd)} (approximate range)`
    : `${String(det.lineStart)}–${String(det.lineEnd)}`;
  const reviewedLabel = det.markedReviewed ? '✅ Marked reviewed' : '⬜ Pending review';
  lines.push(`**${String(index + 1)}. ${det.file} — Lines ${lineRange}**`);
  lines.push(`- Trigger: ${det.trigger}`);
  lines.push(`- Confidence: ${String(det.confidencePct)}% (${det.confidence})`);
  lines.push(`- Attestation ref: \`${det.attestationRef}\``);
  lines.push(`- Action: ${det.action}`);
  lines.push(`- Status: ${reviewedLabel}`);
  lines.push('');
  return lines;
}

function renderFindingsBySeverity(
  allFindings: GapFinding[],
  severity: FindingSeverity,
  heading: string,
): string[] {
  const bucket = allFindings
    .filter(f => f.severity === severity)
    .sort((a, b) => b.deduction - a.deduction);

  if (bucket.length === 0) return [];

  const lines: string[] = [];
  lines.push(`## ${heading}`);
  lines.push('');
  for (const f of bucket) {
    lines.push(...renderFinding(f));
  }
  return lines;
}

export function renderGapReport(report: GapReport): string {
  const lines: string[] = [];

  // ── Header ───────────────────────────────────────────────────────────────────
  lines.push(`# ${report.repoName} — Geodesic Gap Report`);
  lines.push(`Generated: ${report.analyzedAt}`);
  lines.push('');

  // ── Overall Score ────────────────────────────────────────────────────────────
  lines.push(`## Overall Score: ${String(report.overallScore)}/100 (${gradeLabel(report.overallGrade)})`);
  lines.push('');

  // ── Dimension Summary Table ──────────────────────────────────────────────────
  lines.push('| Dimension | Score | Grade | Active | Findings |');
  lines.push('|---|---|---|---|---|');
  for (const dim of report.dimensions) {
    const activeLabel = dim.active ? 'Yes' : 'No (weight redistributed)';
    const scoreLabel = dim.active ? `${String(dim.score)}/100` : 'N/A';
    const gradeStr = dim.active ? dim.grade : '—';
    const findingsLabel = dim.active ? findingCountLabel(dim.findings) : '—';
    lines.push(`| ${dim.dimension} | ${scoreLabel} | ${gradeStr} | ${activeLabel} | ${findingsLabel} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Uncertain PII Detections (always first, if any) ──────────────────────────
  if (report.uncertainDetections.length > 0) {
    const count = String(report.uncertainDetections.length);
    lines.push('## ⚠ Uncertain PII Detections — Human Review Required');
    lines.push('');
    lines.push(`${count} detection${report.uncertainDetections.length !== 1 ? 's' : ''} require human review before this report can be considered complete.`);
    lines.push('Review each location and clear or confirm using: `geodesic review mark-reviewed --ref <entry_id>`');
    lines.push('');
    report.uncertainDetections.forEach((det, i) => {
      lines.push(...renderUncertainDetection(det, i));
    });
    lines.push('---');
    lines.push('');
  }

  // ── Findings by Severity ─────────────────────────────────────────────────────
  const allFindings = report.dimensions.flatMap(d => d.findings);

  const p0Lines = renderFindingsBySeverity(allFindings, 'P0', 'P0 — Critical Findings');
  const p1Lines = renderFindingsBySeverity(allFindings, 'P1', 'P1 — High Priority Findings');
  const p2Lines = renderFindingsBySeverity(allFindings, 'P2', 'P2 — Medium Priority Findings');
  const p3Lines = renderFindingsBySeverity(allFindings, 'P3', 'P3 — Low Priority / Backlog');

  if (p0Lines.length > 0) { lines.push(...p0Lines); lines.push('---'); lines.push(''); }
  if (p1Lines.length > 0) { lines.push(...p1Lines); lines.push('---'); lines.push(''); }
  if (p2Lines.length > 0) { lines.push(...p2Lines); lines.push('---'); lines.push(''); }
  if (p3Lines.length > 0) { lines.push(...p3Lines); lines.push('---'); lines.push(''); }

  if (allFindings.length === 0) {
    lines.push('## No Findings');
    lines.push('');
    lines.push('No gaps detected across all dimensions. The analyzed repository is in excellent shape.');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // ── Recommended Path Forward ─────────────────────────────────────────────────
  lines.push('## Recommended Path Forward');
  lines.push('');
  lines.push(report.recommendedPathForward.trim());
  lines.push('');

  return lines.join('\n');
}

export function computeLetterGrade(score: number): LetterGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function computeDimensionScore(startingScore: number, findings: GapFinding[]): number {
  const total = findings.reduce((sum, f) => sum + f.deduction, 0);
  return Math.max(0, startingScore - total);
}

export function computeOverallScore(dimensions: DimensionScore[]): number {
  const weights: Record<string, number> = {
    Security: 25,
    Compliance: 20,
    Testability: 15,
    Observability: 15,
    Maintainability: 15,
    Documentation: 5,
    Scalability: 5,
  };

  const activeDimensions = dimensions.filter(d => d.active);
  const hasCompliance = activeDimensions.some(d => d.dimension === 'Compliance');

  // Redistribute Compliance weight if inactive
  const effectiveWeights: Record<string, number> = { ...weights };
  if (!hasCompliance) {
    effectiveWeights['Security'] = 33;
    effectiveWeights['Compliance'] = 0;
    effectiveWeights['Testability'] = 20;
    effectiveWeights['Observability'] = 19;
    effectiveWeights['Maintainability'] = 18;
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (const dim of activeDimensions) {
    const weight = effectiveWeights[dim.dimension] ?? 0;
    weightedSum += dim.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 100;
  return Math.round(weightedSum / totalWeight);
}

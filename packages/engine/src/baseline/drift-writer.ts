/**
 * Renders a DriftReport as Markdown for human review, and writes both
 * `DRIFT-REPORT.md` and `drift-report.json` to the output directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DriftFinding, DriftReport } from '@geodesic/types';

export function renderDriftReportMd(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`# Drift Report — ${report.baselineName}`);
  lines.push('');
  lines.push(`Baseline generated: ${report.baselineGeneratedAt}`);
  lines.push(`Compared at: ${report.comparedAt}`);
  lines.push('');
  lines.push(`**Findings:** ${String(report.counts.total)} total · `
    + `P0: ${String(report.counts.p0)} · `
    + `P1: ${String(report.counts.p1)} · `
    + `P2: ${String(report.counts.p2)}`);
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('_No drift detected. Baseline and harvest are aligned._');
    return lines.join('\n') + '\n';
  }

  for (const sev of ['P0', 'P1', 'P2'] as const) {
    const bucket = report.findings.filter(f => f.severity === sev);
    if (bucket.length === 0) continue;
    lines.push(`## ${sev} — ${String(bucket.length)} finding${bucket.length === 1 ? '' : 's'}`);
    lines.push('');
    lines.push('| Entity | Drift | Detail | Baseline ref | Harvested ref |');
    lines.push('|---|---|---|---|---|');
    for (const f of bucket) lines.push(renderRow(f));
    lines.push('');
  }
  return lines.join('\n');
}

function renderRow(f: DriftFinding): string {
  const safe = (s: string | null): string =>
    s === null ? '—' : s.replace(/\|/g, '\\|');
  return `| \`${f.entityId}\` | ${f.driftKind} | ${safe(f.detail)} | ${safe(f.baselineRef)} | ${safe(f.harvestedRef)} |`;
}

export interface WrittenDriftPaths {
  jsonPath: string;
  mdPath: string;
}

export function writeDriftReport(outputDir: string, report: DriftReport): WrittenDriftPaths {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'drift-report.json');
  const mdPath = path.join(outputDir, 'DRIFT-REPORT.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, renderDriftReportMd(report) + '\n', 'utf8');
  return { jsonPath, mdPath };
}

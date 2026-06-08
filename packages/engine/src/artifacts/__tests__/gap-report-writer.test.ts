import { describe, it, expect } from 'vitest';
import {
  renderGapReport,
  computeLetterGrade,
  computeDimensionScore,
  computeOverallScore,
} from '../gap-report-writer.js';
import { makeGapReport } from './fixtures.js';
import type { DimensionScore } from '@geodesic/types';

describe('renderGapReport', () => {
  it('includes repo name in heading', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('my-app — Geodesic Gap Report');
  });

  it('includes overall score and grade', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('62/100');
    expect(output).toContain('C (Significant Gaps)');
  });

  it('renders dimension summary table with all seven dimensions', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('Security');
    expect(output).toContain('Compliance');
    expect(output).toContain('Testability');
    expect(output).toContain('Observability');
    expect(output).toContain('Maintainability');
    expect(output).toContain('Documentation');
    expect(output).toContain('Scalability');
  });

  it('renders uncertain PII detections section when present', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('Uncertain PII Detections — Human Review Required');
    expect(output).toContain('src/utils/logger.ts — Lines 88–91');
    expect(output).toContain('72% (UNCERTAIN)');
    expect(output).toContain('d290');
  });

  it('marks uncertain detection as pending review', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('⬜ Pending review');
  });

  it('marks uncertain detection as reviewed when markedReviewed is true', () => {
    const report = makeGapReport({
      uncertainDetections: [
        {
          entryId: 'd290',
          file: 'src/utils/logger.ts',
          lineStart: 88,
          lineEnd: 91,
          isApproximateRange: false,
          trigger: 'string pattern resembles email address',
          confidencePct: 72,
          confidence: 'UNCERTAIN',
          attestationRef: 'd290',
          action: 'Open file and review.',
          markedReviewed: true,
        },
      ],
    });
    const output = renderGapReport(report);
    expect(output).toContain('✅ Marked reviewed');
  });

  it('renders P0 critical findings section', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('P0 — Critical Findings');
    expect(output).toContain('[P0] PHI fields stored without encryption at rest');
  });

  it('renders P1 findings section', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('P1 — High Priority Findings');
    expect(output).toContain('[P1] No rate limiting on auth endpoints');
  });

  it('renders P2 findings section', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('P2 — Medium Priority Findings');
    expect(output).toContain('[P2] No API documentation');
  });

  it('includes file coordinates in every finding (Law 4)', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('`src/db/schema.ts`');
    expect(output).toContain('Lines 45–89');
  });

  it('includes fix instruction in every finding', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('Enable PostgreSQL column-level encryption');
  });

  it('sorts P0 findings by deduction size descending', () => {
    const output = renderGapReport(makeGapReport());
    const p0Section = output.slice(output.indexOf('P0 — Critical'));
    const encryptionPos = p0Section.indexOf('encryption at rest');
    const auditPos = p0Section.indexOf('audit log');
    // PHI encryption (30 deduction) should appear before audit log (20 deduction)
    expect(encryptionPos).toBeLessThan(auditPos);
  });

  it('renders recommended path forward section', () => {
    const output = renderGapReport(makeGapReport());
    expect(output).toContain('## Recommended Path Forward');
    expect(output).toContain('HIPAA requirements');
  });

  it('omits uncertain detections section when none present', () => {
    const report = makeGapReport({ uncertainDetections: [] });
    const output = renderGapReport(report);
    expect(output).not.toContain('Uncertain PII Detections');
  });

  it('shows no findings message when all dimensions are clean', () => {
    const report = makeGapReport({
      dimensions: [
        { dimension: 'Security', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Testability', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Observability', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Maintainability', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Documentation', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Scalability', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Compliance', score: 100, grade: 'A', active: false, findings: [] },
      ],
    });
    const output = renderGapReport(report);
    expect(output).toContain('No Findings');
  });

  it('shows N/A for inactive dimension score', () => {
    const report = makeGapReport({
      dimensions: [
        { dimension: 'Compliance', score: 0, grade: 'F', active: false, findings: [] },
        { dimension: 'Security', score: 100, grade: 'A', active: true, findings: [] },
        { dimension: 'Testability', score: 80, grade: 'B', active: true, findings: [] },
        { dimension: 'Observability', score: 75, grade: 'B', active: true, findings: [] },
        { dimension: 'Maintainability', score: 90, grade: 'A', active: true, findings: [] },
        { dimension: 'Documentation', score: 60, grade: 'C', active: true, findings: [] },
        { dimension: 'Scalability', score: 70, grade: 'C', active: true, findings: [] },
      ],
    });
    const output = renderGapReport(report);
    expect(output).toContain('N/A');
    expect(output).toContain('weight redistributed');
  });
});

describe('computeLetterGrade', () => {
  it('returns A for scores 90–100', () => {
    expect(computeLetterGrade(90)).toBe('A');
    expect(computeLetterGrade(100)).toBe('A');
    expect(computeLetterGrade(95)).toBe('A');
  });

  it('returns B for scores 75–89', () => {
    expect(computeLetterGrade(75)).toBe('B');
    expect(computeLetterGrade(89)).toBe('B');
  });

  it('returns C for scores 60–74', () => {
    expect(computeLetterGrade(60)).toBe('C');
    expect(computeLetterGrade(74)).toBe('C');
  });

  it('returns D for scores 40–59', () => {
    expect(computeLetterGrade(40)).toBe('D');
    expect(computeLetterGrade(59)).toBe('D');
  });

  it('returns F for scores below 40', () => {
    expect(computeLetterGrade(0)).toBe('F');
    expect(computeLetterGrade(39)).toBe('F');
  });
});

describe('computeDimensionScore', () => {
  it('subtracts finding deductions from starting score', () => {
    const findings = [
      { severity: 'P0' as const, dimension: 'Security' as const, description: '', file: '', lineStart: 1, lineEnd: 1, detail: '', fix: '', deduction: 25 },
      { severity: 'P1' as const, dimension: 'Security' as const, description: '', file: '', lineStart: 1, lineEnd: 1, detail: '', fix: '', deduction: 15 },
    ];
    expect(computeDimensionScore(100, findings)).toBe(60);
  });

  it('floors at 0 — never goes negative', () => {
    const findings = [
      { severity: 'P0' as const, dimension: 'Security' as const, description: '', file: '', lineStart: 1, lineEnd: 1, detail: '', fix: '', deduction: 200 },
    ];
    expect(computeDimensionScore(100, findings)).toBe(0);
  });

  it('returns starting score when no findings', () => {
    expect(computeDimensionScore(100, [])).toBe(100);
  });
});

describe('computeOverallScore', () => {
  it('returns 100 when all dimensions score 100', () => {
    const dimensions: DimensionScore[] = [
      { dimension: 'Security', score: 100, grade: 'A', active: true, findings: [] },
      { dimension: 'Compliance', score: 100, grade: 'A', active: true, findings: [] },
      { dimension: 'Testability', score: 100, grade: 'A', active: true, findings: [] },
      { dimension: 'Observability', score: 100, grade: 'A', active: true, findings: [] },
      { dimension: 'Maintainability', score: 100, grade: 'A', active: true, findings: [] },
      { dimension: 'Documentation', score: 100, grade: 'A', active: true, findings: [] },
      { dimension: 'Scalability', score: 100, grade: 'A', active: true, findings: [] },
    ];
    expect(computeOverallScore(dimensions)).toBe(100);
  });

  it('returns 0 when all active dimensions score 0', () => {
    const dimensions: DimensionScore[] = [
      { dimension: 'Security', score: 0, grade: 'F', active: true, findings: [] },
      { dimension: 'Compliance', score: 0, grade: 'F', active: true, findings: [] },
      { dimension: 'Testability', score: 0, grade: 'F', active: true, findings: [] },
      { dimension: 'Observability', score: 0, grade: 'F', active: true, findings: [] },
      { dimension: 'Maintainability', score: 0, grade: 'F', active: true, findings: [] },
      { dimension: 'Documentation', score: 0, grade: 'F', active: true, findings: [] },
      { dimension: 'Scalability', score: 0, grade: 'F', active: true, findings: [] },
    ];
    expect(computeOverallScore(dimensions)).toBe(0);
  });

  it('redistributes Compliance weight when inactive', () => {
    const withCompliance: DimensionScore[] = [
      { dimension: 'Security', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Compliance', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Testability', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Observability', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Maintainability', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Documentation', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Scalability', score: 80, grade: 'B', active: true, findings: [] },
    ];
    const withoutCompliance: DimensionScore[] = [
      { dimension: 'Security', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Compliance', score: 80, grade: 'B', active: false, findings: [] },
      { dimension: 'Testability', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Observability', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Maintainability', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Documentation', score: 80, grade: 'B', active: true, findings: [] },
      { dimension: 'Scalability', score: 80, grade: 'B', active: true, findings: [] },
    ];
    // When all active dimensions score the same, overall should be the same regardless
    expect(computeOverallScore(withCompliance)).toBe(computeOverallScore(withoutCompliance));
  });
});

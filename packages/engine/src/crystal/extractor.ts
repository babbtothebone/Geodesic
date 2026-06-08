import { randomUUID } from 'crypto';
import type { Crystal, CommonGap, SynthesisResult } from '@geodesic/types';
import { verifyPurity } from '../intercept/index.js';

// ─── LAW 5 Content Fence ──────────────────────────────────────────────────────
// Crystals must contain zero repo-specific data: no file paths, no variable names,
// no line numbers, no repo structure. Only generic structural patterns.

const SOURCE_EXTENSION_PATTERN = /\b\S+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|sql|prisma|graphql)\b/gi;
const FILE_PATH_PATTERN = /\b(?:src|packages|app|lib|pkg|internal|tests?|spec|migrations?|api|routes?|controllers?|models?|services?|middleware|utils?|helpers?|config)\s*\/\S+/gi;
const LINE_REF_PATTERN = /\blines?\s*\d+(?:\s*[-–]\s*\d+)?\b/gi;
const COLON_LINE_PATTERN = /:\d+(?:-\d+)?/g;

function sanitizeForCrystal(text: string): string {
  return text
    .replace(SOURCE_EXTENSION_PATTERN, '[source-file]')
    .replace(FILE_PATH_PATTERN, '[path]')
    .replace(LINE_REF_PATTERN, '[location]')
    .replace(COLON_LINE_PATTERN, '')
    .trim();
}

const REPO_STRUCTURAL_PATTERNS = [
  /\bsrc\/\w/,
  /\bpackages\/\w/,
  /\bapp\/\w/,
  /[/\\]\w[\w.-]*\.(ts|js|py|go|rs|java|rb|php|cs|swift)\b/i, // path-prefixed filenames only — not framework names like Node.js
];

function containsRepoStructuralData(text: string): boolean {
  return REPO_STRUCTURAL_PATTERNS.some(p => p.test(text));
}

function validateCrystalContent(crystal: Crystal): { clean: boolean; reason?: string } {
  const serialized = JSON.stringify(crystal);
  if (containsRepoStructuralData(serialized)) {
    const match = REPO_STRUCTURAL_PATTERNS.find(p => p.test(serialized));
    return { clean: false, reason: `Repo-structural data detected: ${String(match)}` };
  }
  return { clean: true };
}

export interface ExtractionOptions {
  fingerprint: string;
  existing: Crystal | null;
  synthesis: SynthesisResult;
  now?: string;
}

export interface ExtractionResult {
  crystal: Crystal;
  purityPassed: boolean;
  purityFailReason?: string;
}

function buildBootstrapPrompt(crystal: Omit<Crystal, 'bootstrapPrompt'>): string {
  const { stackFingerprint, fitness, stackPatterns, analysisSequence, commonGaps } = crystal;

  const topGaps = [...commonGaps]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 3);

  const steps = analysisSequence
    .map((step, i) => `${String(i + 1)}. ${step}`)
    .join('\n');

  const gapList = topGaps.length > 0
    ? topGaps
        .map(g => `- [${g.severity}] ${g.gap} (${String(Math.round(g.frequency * 100))}% frequency)`)
        .join('\n')
    : '- No common gaps recorded yet';

  const useWord = fitness.useCount === 1 ? 'analysis' : 'analyses';
  return [
    `This codebase uses the ${stackFingerprint} stack. Based on ${String(fitness.useCount)} prior ${useWord} of this stack, the proven approach is:`,
    steps,
    `Typical layer structure: ${stackPatterns.typicalLayerStructure}`,
    'Focus your analysis on what differs from this pattern and on these commonly missing items:',
    gapList,
  ].join('\n\n');
}

function buildStackPatterns(synthesis: SynthesisResult): Crystal['stackPatterns'] {
  const { skillFile } = synthesis;

  // Entry point types only — sanitized to remove any file paths the AI included (Law 5)
  const typicalEntryPoints = [...new Set(
    skillFile.topology.entryPoints.map(ep => sanitizeForCrystal(`${ep.type}: ${ep.description}`)),
  )];

  // Layer names and responsibilities only — sanitized (Law 5)
  const layerDescriptions = skillFile.topology.layers
    .map(l => sanitizeForCrystal(`${l.name}: ${l.responsibility}`))
    .join(' → ');

  // Auth pattern: sanitize in case AI included route paths
  const authPattern = skillFile.stack.authStrategy
    ? sanitizeForCrystal(skillFile.stack.authStrategy)
    : null;

  // DB pattern: engines + ORM label only (no paths expected, but sanitize defensively)
  const dbPattern = skillFile.databases.engines.length > 0
    ? sanitizeForCrystal([
        ...skillFile.databases.engines,
        skillFile.databases.orm ? `with ${skillFile.databases.orm}` : null,
      ]
        .filter((s): s is string => s !== null)
        .join(' '))
    : null;

  return {
    typicalEntryPoints,
    typicalLayerStructure: layerDescriptions || 'No layer structure identified',
    typicalAuthPattern: authPattern,
    typicalDbPattern: dbPattern,
    typicalTestPattern: skillFile.patterns.testingApproach
      ? sanitizeForCrystal(skillFile.patterns.testingApproach)
      : null,
    typicalInfraPattern: sanitizeForCrystal(skillFile.infra.orchestration
      ? `${skillFile.infra.orchestration}${skillFile.infra.ciCdTools.length > 0 ? ` with ${skillFile.infra.ciCdTools.join(', ')}` : ''}`
      : skillFile.infra.ciCdTools.join(', ')) || null,
  };
}

function buildCommonGaps(
  synthesis: SynthesisResult,
  existing: Crystal | null,
  useCount: number,
): CommonGap[] {
  const gapMap = new Map<string, CommonGap>();

  for (const gap of existing?.commonGaps ?? []) {
    gapMap.set(`${gap.dimension}:${gap.gap}`, gap);
  }

  for (const dim of synthesis.gapReport.dimensions) {
    if (!dim.active) continue;
    for (const finding of dim.findings) {
      const key = `${finding.dimension}:${finding.description}`;
      const prev = gapMap.get(key);
      if (prev) {
        const newFreq = (prev.frequency * (useCount - 1) + 1) / useCount;
        gapMap.set(key, { ...prev, frequency: parseFloat(newFreq.toFixed(4)) });
      } else {
        gapMap.set(key, {
          dimension: finding.dimension,
          gap: sanitizeForCrystal(finding.description),
          severity: finding.severity,
          frequency: parseFloat((1 / useCount).toFixed(4)),
        });
      }
    }
  }

  return Array.from(gapMap.values());
}

function buildAnalysisSequence(synthesis: SynthesisResult): string[] {
  const { skillFile } = synthesis;
  const steps: string[] = [
    'Identify primary language and framework from dependency manifests',
    'Map entry points and primary routing mechanism',
  ];

  if (skillFile.databases.engines.length > 0) {
    steps.push('Inspect database schema and ORM configuration for data model patterns');
  }

  steps.push('Trace authentication flow from middleware to route protection');
  steps.push('Enumerate API surface: internal routes, external service calls, webhooks');

  if (skillFile.phiZones.length > 0) {
    steps.push('Identify PHI zones and verify HIPAA protection controls are in place');
  }

  steps.push('Assess test coverage and testing approach across all layers');
  steps.push('Evaluate observability: logging, health checks, error tracking, metrics');
  steps.push('Review CI/CD pipeline and deployment configuration');
  steps.push('Evaluate scalability: connection pooling, caching, background jobs, pagination');
  steps.push('Identify tech debt hotspots from file size, import depth, and duplication signals');

  return steps;
}

export function extractCrystal(options: ExtractionOptions): ExtractionResult {
  const { fingerprint, existing, synthesis, now = new Date().toISOString() } = options;
  const useCount = (existing?.fitness.useCount ?? 0) + 1;
  const successCount = (existing?.fitness.successCount ?? 0) + 1;
  const probationUses = (existing?.fitness.probationUses ?? 0) + 1;

  const prevSavings = existing?.fitness.avgTokenSavingsPct ?? 0;
  const prevCount = existing?.fitness.useCount ?? 0;
  const tokenSavingsPct = existing != null ? Math.min(0.8, prevSavings * 1.05) : 0.0;
  const avgSavings = prevCount > 0
    ? (prevSavings * prevCount + tokenSavingsPct) / useCount
    : tokenSavingsPct;

  const newStatus: Crystal['status'] = (() => {
    if (existing?.status === 'active') return 'active';
    if (probationUses >= 3 && successCount > 0) return 'active';
    return 'probation';
  })();

  const stackPatterns = buildStackPatterns(synthesis);
  const commonGaps = buildCommonGaps(synthesis, existing, useCount);
  const analysisSequence = existing?.analysisSequence ?? buildAnalysisSequence(synthesis);

  const fitnessScore = parseFloat(
    ((successCount / useCount) * 0.6 + avgSavings * 0.3 + 1.0 * 0.1).toFixed(4),
  );

  const crystalWithoutPrompt: Omit<Crystal, 'bootstrapPrompt'> = {
    schemaVersion: '1',
    crystalId: existing?.crystalId ?? randomUUID(),
    stackFingerprint: fingerprint,
    status: newStatus,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: now,
    fitness: {
      useCount,
      probationUses,
      successCount,
      avgTokenSavingsPct: parseFloat(avgSavings.toFixed(4)),
      fitnessScore,
      fitnessHistory: [
        ...(existing?.fitness.fitnessHistory ?? []),
        ...(existing != null
          ? [{ date: now.slice(0, 10), score: existing.fitness.fitnessScore, useCount: existing.fitness.useCount }]
          : []
        ),
      ],
    },
    stackPatterns,
    analysisSequence,
    commonGaps,
  };

  const bootstrapPrompt = sanitizeForCrystal(buildBootstrapPrompt(crystalWithoutPrompt));
  const crystal: Crystal = { ...crystalWithoutPrompt, bootstrapPrompt };

  // Law 5: two-layer purity check before any write
  // Layer 1: PII/PHI check — pass the object (not JSON string) to avoid escape-sequence false positives
  const purityResult = verifyPurity(crystal);
  if (!purityResult.clean) {
    const reason = `PII pattern "${purityResult.firstMatchPattern ?? 'unknown'}" at position ${String(purityResult.firstMatchPosition ?? -1)}`;
    return { crystal, purityPassed: false, purityFailReason: reason };
  }

  // Layer 2: Repo-structural content check (no file paths, no source references)
  const contentFenceResult = validateCrystalContent(crystal);
  if (!contentFenceResult.clean) {
    return { crystal, purityPassed: false, purityFailReason: contentFenceResult.reason };
  }

  return { crystal, purityPassed: true };
}

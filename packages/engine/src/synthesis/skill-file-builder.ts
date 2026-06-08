import type {
  HarvestResult,
  SkillFileJson,
  SkillFileApiRoute,
  PhiZone,
  SkillFileEnvVars,
} from '@geodesic/types';
import { GEODESIC_VERSION } from '../version.js';

// ─── Narrative Patch ──────────────────────────────────────────────────────────
// The only fields the LLM needs to fill — everything else comes from harvest.

export interface SkillFileNarrativePatch {
  topology?: {
    layers?: Array<{ name: string; path: string; responsibility: string; keyFiles: string[] }>;
  };
  apis?: {
    external?: Array<{ service: string; baseUrlPattern: string; authMethod: string; filesReferencing: string[] }>;
    webhooks?: Array<{ path: string; provider: string; file: string; line: number; verified: boolean }>;
  };
  patterns?: {
    authFlow?: string;
    errorHandling?: string;
    testingApproach?: string;
    logging?: string;
    apiVersioning?: string | null;
    rateLimiting?: string | null;
  };
  devHooks?: {
    addApiRoute?: string;
    addDbModel?: string;
    addMigration?: string;
    addTest?: string;
    addMiddleware?: string;
    addEnvVar?: string;
  };
  constraints?: {
    knownQuirks?: string[];
    breakingChangeRisks?: string[];
    techDebtHotspots?: string[];
  };
  infra?: {
    orchestration?: string | null;
    hasMonitoring?: boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferRuntime(harvest: HarvestResult): string | null {
  const lang = harvest.languages.primary;
  if (lang === 'TypeScript' || lang === 'JavaScript') return 'Node.js';
  if (lang === 'Python') return 'Python';
  if (lang === 'Go') return 'Go';
  if (lang === 'Rust') return 'Rust';
  if (lang === 'Java' || lang === 'Kotlin') return 'JVM';
  if (lang === 'C#') return '.NET';
  return null;
}

function inferAuthStrategy(harvest: HarvestResult): string | null {
  if (harvest.auth.patterns.length === 0) return null;
  return harvest.auth.patterns.map(p => p.type).join(' + ');
}

function buildInternalRoutes(harvest: HarvestResult): SkillFileApiRoute[] {
  const phiFiles = new Set(harvest.piiCandidateLocations.map(p => p.file));
  return harvest.apiRoutes.map(r => ({
    method: r.method,
    path: r.path,
    file: r.file,
    line: r.line,
    authRequired: r.authRequired,
    authMethod: r.authMethod,
    phiAdjacent: phiFiles.has(r.file),
  }));
}

function buildEnvVars(harvest: HarvestResult): SkillFileEnvVars {
  const seen = new Map<string, typeof harvest.envVars[number]>();
  for (const entry of harvest.envVars) {
    if (!seen.has(entry.name)) seen.set(entry.name, entry);
  }
  const unique = [...seen.values()];
  const required = unique
    .filter(e => e.isSecret && !e.isTemplate)
    .map(e => ({ name: e.name, purpose: e.inferredPurpose ?? 'unknown', isSecret: true }));
  const optional = unique
    .filter(e => !e.isSecret || e.isTemplate)
    .map(e => ({ name: e.name, purpose: e.inferredPurpose ?? 'unknown', defaultDescribed: null }));
  return { required, optional, missingFromExample: [] };
}

const MAX_PHI_ZONES = 50;

function buildPhiZones(harvest: HarvestResult): PhiZone[] {
  const byFile = new Map<string, typeof harvest.piiCandidateLocations>();
  for (const p of harvest.piiCandidateLocations) {
    const arr = byFile.get(p.file) ?? [];
    arr.push(p);
    byFile.set(p.file, arr);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_PHI_ZONES)
    .map(([file, locs]) => {
      const lineStart = locs.reduce((min, l) => Math.min(min, l.lineStart), Infinity);
      const lineEnd   = locs.reduce((max, l) => Math.max(max, l.lineEnd),   0);
      const uniqueHints = [...new Set(locs.map(l => l.hint))].slice(0, 3);
      return {
        file,
        lineStart: lineStart === Infinity ? 0 : lineStart,
        lineEnd,
        phiFieldCount: locs.length,
        hipaaCategories: [],
        attestationRefs: [],
        protectionPresent: [],
        protectionMissing: [],
        devNote: uniqueHints.join('; '),
      };
    });
}

function buildCiCdTools(harvest: HarvestResult): string[] {
  const tools: string[] = [];
  if (harvest.cicd.githubActions.length > 0) tools.push('GitHub Actions');
  if (harvest.cicd.docker.hasDockerfile)     tools.push('Docker');
  if (harvest.cicd.kubernetes)               tools.push('Kubernetes');
  if (harvest.cicd.helm)                     tools.push('Helm');
  if (harvest.cicd.makefile.present)         tools.push('Make');
  return tools;
}

function hasHealthCheckRoute(harvest: HarvestResult): boolean {
  const healthPaths = new Set(['/health', '/ping', '/ready', '/live', '/healthz', '/readyz', '/status']);
  return harvest.apiRoutes.some(r => healthPaths.has(r.path) || healthPaths.has(`/${r.path.split('/').pop() ?? ''}`));
}

function buildEntryPoints(harvest: HarvestResult) {
  return harvest.importGraph.entryPoints.slice(0, 10).map(file => {
    const lower = file.toLowerCase();
    let type = 'module';
    if (lower.includes('server') || lower.includes('app') || lower.includes('main') || lower.endsWith('index.ts') || lower.endsWith('index.js')) type = 'server';
    if (lower.includes('/cli') || lower.includes('/bin')) type = 'cli';
    if (lower.includes('worker') || lower.includes('queue')) type = 'worker';
    if (lower.includes('cron') || lower.includes('scheduler')) type = 'cron';
    return { file, type, description: '' };
  });
}

function buildKeyModules(harvest: HarvestResult) {
  const inboundCount = new Map<string, number>();
  for (const edge of harvest.importGraph.edges) {
    if (!edge.isExternal) {
      inboundCount.set(edge.to, (inboundCount.get(edge.to) ?? 0) + 1);
    }
  }
  return harvest.importGraph.hubFiles.slice(0, 15).map(file => {
    const record = harvest.fileRecords[file];
    const purpose = record?.extraction.type === 'source'
      ? (record.extraction.exports.slice(0, 3).join(', ') || 'shared module')
      : record?.extraction.type === 'config' ? 'configuration'
      : record?.extraction.type === 'schema' ? 'data schema'
      : 'shared module';
    return {
      name: file.split('/').pop() ?? file,
      path: file,
      purpose,
      importedByCount: inboundCount.get(file) ?? 0,
    };
  });
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export function assembleSkillFile(
  harvest: HarvestResult,
  meta: {
    analystId: string;
    repo: string;
    repoCommit: string;
    crystalId: string | null;
    crystalMatchScore: number | null;
    analysisDurationMs: number;
    provider: string;
    model: string;
  },
  patch: SkillFileNarrativePatch,
): SkillFileJson {
  const { cicd, databases, framework, languages } = harvest;

  return {
    $schema: 'https://geodesic.dev/schema/v1/skill-file.json',
    meta: {
      geodeVersion: GEODESIC_VERSION,
      schemaVersion: '1',
      analyzedAt: new Date().toISOString(),
      ...meta,
    },
    stack: {
      primaryLanguage: languages.primary,
      allLanguages: languages.all.map(l => l.language),
      runtime: inferRuntime(harvest),
      framework: framework.primary,
      secondaryFrameworks: framework.all.filter(f => f !== framework.primary),
      orm: databases.orm,
      authStrategy: inferAuthStrategy(harvest),
      emailProvider: null,
      paymentProvider: null,
      deployment: null,
      isMonorepo: framework.isMonorepo,
      monoRepoTool: framework.monoRepoTool,
    },
    topology: {
      entryPoints: buildEntryPoints(harvest),
      layers: patch.topology?.layers ?? [],
      keyModules: buildKeyModules(harvest),
      circularDependencies: harvest.importGraph.circularCycles.map(c => ({
        files: c.cycle,
        description: `Circular: ${c.cycle.join(' → ')}`,
      })),
    },
    apis: {
      internal: buildInternalRoutes(harvest),
      external: patch.apis?.external ?? [],
      webhooks: patch.apis?.webhooks ?? [],
    },
    databases: {
      engines: databases.engines,
      orm: databases.orm,
      migrationsTool: databases.migrationsTool,
      migrationCount: databases.migrationCount,
      schemaFiles: databases.schemaFiles,
      connectionEnvVars: databases.connectionEnvVars,
      phiTablesDetected: harvest.piiCandidateLocations.some(p =>
        databases.schemaFiles.some(sf => p.file === sf || p.file.startsWith(sf)),
      ),
    },
    envVars: {
      ...buildEnvVars(harvest),
      missingFromExample: [],
    },
    patterns: {
      authFlow:        patch.patterns?.authFlow        ?? '',
      errorHandling:   patch.patterns?.errorHandling   ?? '',
      testingApproach: patch.patterns?.testingApproach ?? '',
      logging:         patch.patterns?.logging         ?? '',
      apiVersioning:   patch.patterns?.apiVersioning   ?? null,
      rateLimiting:    patch.patterns?.rateLimiting    ?? null,
    },
    phiZones: buildPhiZones(harvest),
    devHooks: {
      addApiRoute:    patch.devHooks?.addApiRoute    ?? '',
      addDbModel:     patch.devHooks?.addDbModel     ?? '',
      addMigration:   patch.devHooks?.addMigration   ?? '',
      addTest:        patch.devHooks?.addTest        ?? '',
      addMiddleware:  patch.devHooks?.addMiddleware  ?? '',
      addEnvVar:      patch.devHooks?.addEnvVar      ?? '',
    },
    constraints: {
      knownQuirks:         patch.constraints?.knownQuirks         ?? [],
      breakingChangeRisks: patch.constraints?.breakingChangeRisks ?? [],
      techDebtHotspots:    patch.constraints?.techDebtHotspots    ?? [],
    },
    infra: {
      containerized:     cicd.docker.hasDockerfile,
      orchestration:     patch.infra?.orchestration ?? (cicd.kubernetes ? 'Kubernetes' : cicd.helm ? 'Helm' : null),
      ciCdTools:         buildCiCdTools(harvest),
      deploymentTargets: cicd.deploymentTargets,
      hasHealthCheck:    hasHealthCheckRoute(harvest),
      hasMonitoring:     patch.infra?.hasMonitoring ?? false,
    },
  };
}

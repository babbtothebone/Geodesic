import type { SkillFileJson, PhiZone, SkillFileApiRoute } from '@geodesic/types';

// ── JSON Serialization (camelCase → snake_case per spec schema) ───────────────

export function renderSkillFileJson(sf: SkillFileJson): string {
  const obj = buildJsonObject(sf);
  return JSON.stringify(obj, null, 2);
}

function buildJsonObject(sf: SkillFileJson): Record<string, unknown> {
  return {
    '$schema': sf.$schema,
    meta: {
      geode_version: sf.meta.geodeVersion,
      schema_version: sf.meta.schemaVersion,
      analyzed_at: sf.meta.analyzedAt,
      analyst_id: sf.meta.analystId,
      repo: sf.meta.repo,
      repo_commit: sf.meta.repoCommit,
      crystal_id: sf.meta.crystalId,
      crystal_match_score: sf.meta.crystalMatchScore,
      analysis_duration_ms: sf.meta.analysisDurationMs,
      provider: sf.meta.provider,
      model: sf.meta.model,
    },
    stack: {
      primary_language: sf.stack.primaryLanguage,
      all_languages: sf.stack.allLanguages,
      runtime: sf.stack.runtime,
      framework: sf.stack.framework,
      secondary_frameworks: sf.stack.secondaryFrameworks,
      orm: sf.stack.orm,
      auth_strategy: sf.stack.authStrategy,
      email_provider: sf.stack.emailProvider,
      payment_provider: sf.stack.paymentProvider,
      deployment: sf.stack.deployment,
      is_monorepo: sf.stack.isMonorepo,
      monorepo_tool: sf.stack.monoRepoTool,
    },
    topology: {
      entry_points: sf.topology.entryPoints.map(ep => ({
        file: ep.file,
        type: ep.type,
        description: ep.description,
      })),
      layers: sf.topology.layers.map(l => ({
        name: l.name,
        path: l.path,
        responsibility: l.responsibility,
        key_files: l.keyFiles,
      })),
      key_modules: sf.topology.keyModules.map(m => ({
        name: m.name,
        path: m.path,
        purpose: m.purpose,
        imported_by_count: m.importedByCount,
      })),
      circular_dependencies: sf.topology.circularDependencies.map(cd => ({
        files: cd.files,
        description: cd.description,
      })),
    },
    apis: {
      internal: sf.apis.internal.map(r => ({
        method: r.method,
        path: r.path,
        file: r.file,
        line: r.line,
        auth_required: r.authRequired,
        auth_method: r.authMethod,
        phi_adjacent: r.phiAdjacent,
      })),
      external: sf.apis.external.map(e => ({
        service: e.service,
        base_url_pattern: e.baseUrlPattern,
        auth_method: e.authMethod,
        files_referencing: e.filesReferencing,
      })),
      webhooks: sf.apis.webhooks.map(w => ({
        path: w.path,
        provider: w.provider,
        file: w.file,
        line: w.line,
        verified: w.verified,
      })),
    },
    databases: {
      engines: sf.databases.engines,
      orm: sf.databases.orm,
      migrations_tool: sf.databases.migrationsTool,
      migration_count: sf.databases.migrationCount,
      schema_files: sf.databases.schemaFiles,
      connection_env_vars: sf.databases.connectionEnvVars,
      phi_tables_detected: sf.databases.phiTablesDetected,
    },
    env_vars: {
      required: sf.envVars.required.map(v => ({
        name: v.name,
        purpose: v.purpose,
        is_secret: v.isSecret,
      })),
      optional: sf.envVars.optional.map(v => ({
        name: v.name,
        purpose: v.purpose,
        default_described: v.defaultDescribed,
      })),
      missing_from_example: sf.envVars.missingFromExample,
    },
    patterns: {
      auth_flow: sf.patterns.authFlow,
      error_handling: sf.patterns.errorHandling,
      testing_approach: sf.patterns.testingApproach,
      logging: sf.patterns.logging,
      api_versioning: sf.patterns.apiVersioning,
      rate_limiting: sf.patterns.rateLimiting,
    },
    phi_zones: sf.phiZones.map(z => ({
      file: z.file,
      line_start: z.lineStart,
      line_end: z.lineEnd,
      phi_field_count: z.phiFieldCount,
      hipaa_categories: z.hipaaCategories,
      attestation_refs: z.attestationRefs,
      protection_present: z.protectionPresent,
      protection_missing: z.protectionMissing,
      dev_note: z.devNote,
    })),
    dev_hooks: {
      add_api_route: sf.devHooks.addApiRoute,
      add_db_model: sf.devHooks.addDbModel,
      add_migration: sf.devHooks.addMigration,
      add_test: sf.devHooks.addTest,
      add_middleware: sf.devHooks.addMiddleware,
      add_env_var: sf.devHooks.addEnvVar,
    },
    constraints: {
      known_quirks: sf.constraints.knownQuirks,
      breaking_change_risks: sf.constraints.breakingChangeRisks,
      tech_debt_hotspots: sf.constraints.techDebtHotspots,
    },
    infra: {
      containerized: sf.infra.containerized,
      orchestration: sf.infra.orchestration,
      ci_cd_tools: sf.infra.ciCdTools,
      deployment_targets: sf.infra.deploymentTargets,
      has_health_check: sf.infra.hasHealthCheck,
      has_monitoring: sf.infra.hasMonitoring,
    },
  };
}

// ── Markdown Rendering ────────────────────────────────────────────────────────

export function renderSkillFileMd(sf: SkillFileJson): string {
  const lines: string[] = [];
  const { meta, stack, topology, apis, databases, envVars, phiZones, devHooks, constraints, infra } = sf;

  // ── Header ───────────────────────────────────────────────────────────────────
  lines.push(`# ${meta.repo} — Geodesic Skill File`);
  const crystalLabel = meta.crystalId ? `Crystal: ${meta.crystalId}` : 'cold start';
  lines.push(`Generated: ${meta.analyzedAt} | Provider: ${meta.provider} (${meta.model}) | ${crystalLabel}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Stack ────────────────────────────────────────────────────────────────────
  lines.push('## Stack');
  lines.push('');
  const langList = stack.allLanguages.length > 1
    ? `${stack.primaryLanguage} (${stack.allLanguages.join(', ')})`
    : stack.primaryLanguage;
  lines.push(`- **Language:** ${langList}`);
  if (stack.runtime) lines.push(`- **Runtime:** ${stack.runtime}`);
  if (stack.framework) lines.push(`- **Framework:** ${stack.framework}`);
  if (stack.secondaryFrameworks.length > 0) lines.push(`- **Secondary:** ${stack.secondaryFrameworks.join(', ')}`);
  if (stack.orm) lines.push(`- **ORM:** ${stack.orm}`);
  if (stack.authStrategy) lines.push(`- **Auth:** ${stack.authStrategy}`);
  if (stack.emailProvider) lines.push(`- **Email:** ${stack.emailProvider}`);
  if (stack.paymentProvider) lines.push(`- **Payments:** ${stack.paymentProvider}`);
  if (stack.deployment) lines.push(`- **Deployment:** ${stack.deployment}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Architecture Overview (from topology structured data) ────────────────────
  lines.push('## Architecture Overview');
  lines.push('');

  if (topology.entryPoints.length > 0) {
    lines.push('### Entry Points');
    lines.push('');
    for (const ep of topology.entryPoints) {
      lines.push(`- **${ep.file}** (${ep.type}) — ${ep.description}`);
    }
    lines.push('');
  }

  if (topology.layers.length > 0) {
    lines.push('### Layers');
    lines.push('');
    for (const layer of topology.layers) {
      lines.push(`- **${layer.name}** (\`${layer.path}\`) — ${layer.responsibility}`);
    }
    lines.push('');
  }

  if (topology.keyModules.length > 0) {
    lines.push('### Key Modules');
    lines.push('');
    lines.push('| Module | Path | Purpose | Imported By |');
    lines.push('|---|---|---|---|');
    for (const mod of topology.keyModules) {
      lines.push(`| ${mod.name} | ${mod.path} | ${mod.purpose} | ${String(mod.importedByCount)} |`);
    }
    lines.push('');
  }

  if (topology.circularDependencies.length > 0) {
    lines.push(`### ⚠ Circular Dependencies (${String(topology.circularDependencies.length)})`);
    lines.push('');
    for (const cd of topology.circularDependencies) {
      lines.push(`- ${cd.files.join(' → ')} — ${cd.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // ── API Surface ──────────────────────────────────────────────────────────────
  if (apis.internal.length > 0 || apis.external.length > 0 || apis.webhooks.length > 0) {
    lines.push('## API Surface');
    lines.push('');

    if (apis.internal.length > 0) {
      lines.push(`### Internal Routes (${String(apis.internal.length)} endpoints)`);
      lines.push('');
      lines.push('| Method | Path | File | Auth | PHI |');
      lines.push('|---|---|---|---|---|');
      for (const route of apis.internal) {
        lines.push(...renderRouteRow(route));
      }
      lines.push('');
    }

    if (apis.external.length > 0) {
      lines.push('### External Services');
      lines.push('');
      for (const svc of apis.external) {
        lines.push(`- **${svc.service}** — ${svc.authMethod}`);
      }
      lines.push('');
    }

    if (apis.webhooks.length > 0) {
      lines.push('### Webhooks');
      lines.push('');
      for (const wh of apis.webhooks) {
        const verifiedLabel = wh.verified ? 'verified' : '⚠ unverified';
        lines.push(`- **${wh.provider}** \`${wh.path}\` — ${verifiedLabel}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // ── Database ─────────────────────────────────────────────────────────────────
  if (databases.engines.length > 0) {
    lines.push('## Database');
    lines.push('');
    lines.push(`- **Engine:** ${databases.engines.join(', ')}`);
    if (databases.orm) lines.push(`- **ORM:** ${databases.orm}`);
    if (databases.migrationsTool) {
      const count = String(databases.migrationCount);
      lines.push(`- **Migrations:** ${databases.migrationsTool} (${count} migration${databases.migrationCount !== 1 ? 's' : ''})`);
    }
    if (databases.schemaFiles.length > 0) lines.push(`- **Schema files:** ${databases.schemaFiles.join(', ')}`);
    lines.push(`- **PHI tables detected:** ${databases.phiTablesDetected ? '⚠ Yes' : 'No'}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // ── Environment Variables ────────────────────────────────────────────────────
  if (envVars.required.length > 0 || envVars.optional.length > 0 || envVars.missingFromExample.length > 0) {
    lines.push('## Environment Variables');
    lines.push('');

    if (envVars.required.length > 0) {
      lines.push('### Required');
      lines.push('');
      lines.push('| Name | Purpose | Secret |');
      lines.push('|---|---|---|');
      for (const v of envVars.required) {
        lines.push(`| \`${v.name}\` | ${v.purpose} | ${v.isSecret ? 'yes' : 'no'} |`);
      }
      lines.push('');
    }

    if (envVars.optional.length > 0) {
      lines.push('### Optional');
      lines.push('');
      lines.push('| Name | Purpose | Default |');
      lines.push('|---|---|---|');
      for (const v of envVars.optional) {
        lines.push(`| \`${v.name}\` | ${v.purpose} | ${v.defaultDescribed ?? '—'} |`);
      }
      lines.push('');
    }

    if (envVars.missingFromExample.length > 0) {
      lines.push('### ⚠ Missing from .env.example');
      lines.push('');
      for (const name of envVars.missingFromExample) {
        lines.push(`- \`${name}\``);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // ── PHI Zones ────────────────────────────────────────────────────────────────
  if (phiZones.length > 0) {
    const count = String(phiZones.length);
    lines.push(`## ⚠ PHI Zones (${count} zone${phiZones.length !== 1 ? 's' : ''})`);
    lines.push('');
    for (const zone of phiZones) {
      lines.push(...renderPhiZoneBlock(zone));
    }
    lines.push('---');
    lines.push('');
  }

  // ── How to Extend ────────────────────────────────────────────────────────────
  lines.push('## How to Extend This Codebase');
  lines.push('');

  lines.push('### Add an API Route');
  lines.push('');
  lines.push(devHooks.addApiRoute);
  lines.push('');

  lines.push('### Add a Database Model');
  lines.push('');
  lines.push(devHooks.addDbModel);
  lines.push('');

  lines.push('### Add a Migration');
  lines.push('');
  lines.push(devHooks.addMigration);
  lines.push('');

  lines.push('### Add a Test');
  lines.push('');
  lines.push(devHooks.addTest);
  lines.push('');

  lines.push('### Add Middleware');
  lines.push('');
  lines.push(devHooks.addMiddleware);
  lines.push('');

  lines.push('### Add an Environment Variable');
  lines.push('');
  lines.push(devHooks.addEnvVar);
  lines.push('');

  lines.push('---');
  lines.push('');

  // ── Constraints ──────────────────────────────────────────────────────────────
  if (constraints.knownQuirks.length > 0) {
    lines.push('## Watch Out For');
    lines.push('');
    constraints.knownQuirks.forEach((q, i) => {
      lines.push(`${String(i + 1)}. ${q}`);
    });
    lines.push('');
  }

  if (constraints.breakingChangeRisks.length > 0) {
    lines.push('## Breaking Change Risks');
    lines.push('');
    constraints.breakingChangeRisks.forEach((r, i) => {
      lines.push(`${String(i + 1)}. ${r}`);
    });
    lines.push('');
  }

  if (constraints.techDebtHotspots.length > 0) {
    lines.push('## Tech Debt Hotspots');
    lines.push('');
    constraints.techDebtHotspots.forEach((h, i) => {
      lines.push(`${String(i + 1)}. ${h}`);
    });
    lines.push('');
  }

  if (constraints.knownQuirks.length > 0 ||
      constraints.breakingChangeRisks.length > 0 ||
      constraints.techDebtHotspots.length > 0) {
    lines.push('---');
    lines.push('');
  }

  // ── Infrastructure ───────────────────────────────────────────────────────────
  lines.push('## Infrastructure');
  lines.push('');
  const containerLabel = infra.containerized ? 'Yes' : 'No';
  const orchLabel = infra.orchestration ?? 'none';
  lines.push(`- **Containers:** ${containerLabel} | **Orchestration:** ${orchLabel}`);
  if (infra.ciCdTools.length > 0) lines.push(`- **CI/CD:** ${infra.ciCdTools.join(', ')}`);
  const hcLabel = infra.hasHealthCheck ? 'Present' : '⚠ Missing';
  const monLabel = infra.hasMonitoring ? 'Present' : '⚠ Missing';
  lines.push(`- **Health check:** ${hcLabel} | **Monitoring:** ${monLabel}`);
  lines.push('');

  return lines.join('\n');
}

function renderRouteRow(route: SkillFileApiRoute): string[] {
  const authLabel = route.authRequired ? (route.authMethod ?? 'yes') : 'no';
  const phiLabel = route.phiAdjacent ? '⚠ yes' : 'no';
  return [`| ${route.method} | \`${route.path}\` | ${route.file}:${String(route.line)} | ${authLabel} | ${phiLabel} |`];
}

function renderPhiZoneBlock(zone: PhiZone): string[] {
  const lines: string[] = [];
  lines.push(`**${zone.file} — Lines ${String(zone.lineStart)}–${String(zone.lineEnd)}**`);
  lines.push('');
  lines.push(`- PHI fields: ${String(zone.phiFieldCount)} | HIPAA categories: ${zone.hipaaCategories.join(', ')}`);
  const presentLabel = zone.protectionPresent.length > 0 ? zone.protectionPresent.join(', ') : 'none';
  lines.push(`- Protection present: ${presentLabel}`);
  const missingLabel = zone.protectionMissing.length > 0 ? zone.protectionMissing.join(', ') : 'none';
  lines.push(`- Protection missing: ${missingLabel}`);
  if (zone.attestationRefs.length > 0) {
    lines.push(`- Attestation refs: ${zone.attestationRefs.join(', ')}`);
  }
  lines.push(`- Note: ${zone.devNote}`);
  lines.push('');
  return lines;
}


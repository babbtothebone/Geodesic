import type { SynthesisResult } from '@geodesic/types';

export function renderArchitectureMap(synthesis: SynthesisResult): string {
  const { skillFile, architectureMapMarkdown } = synthesis;
  const { meta, stack, apis, databases, phiZones, infra } = skillFile;

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(`# ${meta.repo} — Architecture Map`);
  const crystalLabel = synthesis.crystalId ? `Crystal: ${synthesis.crystalId}` : 'Cold start';
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
  lines.push(`- **Monorepo:** ${stack.isMonorepo ? `Yes${stack.monoRepoTool ? ` (${stack.monoRepoTool})` : ''}` : 'No'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Architecture Overview (AI narrative) ────────────────────────────────────
  lines.push('## Architecture Overview');
  lines.push('');
  lines.push(architectureMapMarkdown.trim());
  lines.push('');
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
        const authLabel = route.authRequired ? (route.authMethod ?? 'yes') : 'no';
        const phiLabel = route.phiAdjacent ? '⚠ yes' : 'no';
        lines.push(`| ${route.method} | \`${route.path}\` | ${route.file}:${String(route.line)} | ${authLabel} | ${phiLabel} |`);
      }
      lines.push('');
    }

    if (apis.external.length > 0) {
      lines.push('### External Services');
      lines.push('');
      for (const svc of apis.external) {
        lines.push(`- **${svc.service}** — Auth: ${svc.authMethod} | Base: \`${svc.baseUrlPattern}\``);
        if (svc.filesReferencing.length > 0) {
          lines.push(`  Files: ${svc.filesReferencing.join(', ')}`);
        }
      }
      lines.push('');
    }

    if (apis.webhooks.length > 0) {
      lines.push('### Webhooks');
      lines.push('');
      for (const wh of apis.webhooks) {
        const verifiedLabel = wh.verified ? 'signature verified' : '⚠ NOT verified';
        lines.push(`- **${wh.provider}** \`${wh.path}\` — ${verifiedLabel} (${wh.file}:${String(wh.line)})`);
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
    if (databases.connectionEnvVars.length > 0) lines.push(`- **Connection env vars:** ${databases.connectionEnvVars.join(', ')}`);
    lines.push(`- **PHI tables detected:** ${databases.phiTablesDetected ? '⚠ Yes' : 'No'}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // ── PHI Zones ────────────────────────────────────────────────────────────────
  if (phiZones.length > 0) {
    const zoneCount = String(phiZones.length);
    lines.push(`## ⚠ PHI Zones (${zoneCount} zone${phiZones.length !== 1 ? 's' : ''})`);
    lines.push('');
    for (const zone of phiZones) {
      lines.push(`### ${zone.file} — Lines ${String(zone.lineStart)}–${String(zone.lineEnd)}`);
      lines.push('');
      lines.push(`- **PHI fields:** ${String(zone.phiFieldCount)}`);
      lines.push(`- **HIPAA categories:** ${zone.hipaaCategories.join(', ')}`);
      const presentLabel = zone.protectionPresent.length > 0 ? zone.protectionPresent.join(', ') : 'none';
      lines.push(`- **Protection present:** ${presentLabel}`);
      if (zone.protectionMissing.length > 0) {
        lines.push(`- **Protection missing:** ⚠ ${zone.protectionMissing.join(', ')}`);
      }
      if (zone.attestationRefs.length > 0) {
        lines.push(`- **Attestation refs:** ${zone.attestationRefs.join(', ')}`);
      }
      lines.push(`- **Note:** ${zone.devNote}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // ── Infrastructure ───────────────────────────────────────────────────────────
  lines.push('## Infrastructure');
  lines.push('');
  lines.push(`- **Containers:** ${infra.containerized ? 'Yes' : 'No'}`);
  if (infra.orchestration) lines.push(`- **Orchestration:** ${infra.orchestration}`);
  if (infra.ciCdTools.length > 0) lines.push(`- **CI/CD:** ${infra.ciCdTools.join(', ')}`);
  if (infra.deploymentTargets.length > 0) lines.push(`- **Deploy targets:** ${infra.deploymentTargets.join(', ')}`);
  lines.push(`- **Health check:** ${infra.hasHealthCheck ? 'Present' : '⚠ Missing'}`);
  lines.push(`- **Monitoring:** ${infra.hasMonitoring ? 'Present' : '⚠ Missing'}`);
  lines.push('');

  return lines.join('\n');
}

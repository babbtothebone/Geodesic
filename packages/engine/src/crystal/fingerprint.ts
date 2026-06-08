import type { HarvestResult } from '@geodesic/types';

const VERSION_RE = /\d+(\.\d+)*/g;

const ORM_ALIASES: Record<string, string> = {
  'drizzle-orm': 'drizzle',
  '@drizzle-team/drizzle-orm': 'drizzle',
  'drizzle_orm': 'drizzle',
  '@prisma/client': 'prisma',
  'mikro-orm': 'mikroorm',
  '@mikro-orm/core': 'mikroorm',
  'active_record': 'activerecord',
  'active-record': 'activerecord',
  'tortoise-orm': 'tortoise',
  'sqlalchemy[asyncio]': 'sqlalchemy',
  'typeorm': 'typeorm',
  'sequelize': 'sequelize',
};

const AUTH_ALIASES: Record<string, string> = {
  jwt: 'jwt',
  apikey: 'apikey',
  session: 'session',
  oauth: 'oauth',
  magic_link: 'magic-link',
  unknown: 'unknown',
};

const FRAMEWORK_ALIASES: Record<string, string> = {
  'next.js': 'nextjs',
  'next-js': 'nextjs',
  'nuxt.js': 'nuxt',
  'nest.js': 'nestjs',
  '@nestjs/core': 'nestjs',
  'spring-boot': 'spring',
  'spring boot': 'spring',
  'ruby-on-rails': 'rails',
  'ruby on rails': 'rails',
  'fast-api': 'fastapi',
  '@hono/hono': 'hono',
};

function stripVersion(s: string): string {
  return s
    .replace(VERSION_RE, '')
    .replace(/[-_.\s]+$/g, '')
    .replace(/[-_\s]+/g, '-');
}

function normalizeSegment(s: string): string {
  if (!s || s === 'unknown') return 'unknown';
  const lower = s.toLowerCase();
  return stripVersion(lower) || 'unknown';
}

function resolveAlias(aliases: Record<string, string>, value: string): string {
  const key = value.toLowerCase().trim();
  return aliases[key] ?? normalizeSegment(value);
}

function resolveFramework(framework: string | null): string {
  if (!framework) return 'unknown';
  const first = framework.split(/\s+/)[0] ?? framework;
  return resolveAlias(FRAMEWORK_ALIASES, first);
}

function resolveOrm(orm: string | null): string {
  if (!orm) return 'unknown';
  return resolveAlias(ORM_ALIASES, orm);
}

function resolveAuth(harvest: HarvestResult): string {
  const first = harvest.auth.patterns[0];
  if (!first) return 'unknown';
  return AUTH_ALIASES[first.type] ?? first.type;
}

function resolveDeployment(harvest: HarvestResult): string {
  if (harvest.cicd.kubernetes) return 'kubernetes';
  if (harvest.cicd.docker.hasDockerfile) {
    const targets = harvest.cicd.deploymentTargets;
    if (targets.some(t => t.toLowerCase().includes('vercel'))) return 'vercel';
    if (targets.some(t => t.toLowerCase().includes('heroku'))) return 'heroku';
    return 'docker';
  }
  const targets = harvest.cicd.deploymentTargets;
  if (targets.length === 0) return 'unknown';
  const t = (targets[0] ?? '').toLowerCase();
  if (t.includes('vercel')) return 'vercel';
  if (t.includes('heroku')) return 'heroku';
  if (t.includes('nginx')) return 'nginx';
  if (t.includes('vps')) return 'vps';
  return normalizeSegment(t);
}

export function computeFingerprint(harvest: HarvestResult): string {
  const lang = normalizeSegment(harvest.languages.primary);
  const framework = resolveFramework(harvest.framework.primary);
  const orm = resolveOrm(harvest.databases.orm);
  const auth = resolveAuth(harvest);
  const deploy = resolveDeployment(harvest);
  return [lang, framework, orm, auth, deploy].join('+');
}

export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint
    .split('+')
    .map(s => normalizeSegment(s))
    .join('+');
}

export function parseFingerprint(fingerprint: string): string[] {
  return fingerprint.split('+');
}

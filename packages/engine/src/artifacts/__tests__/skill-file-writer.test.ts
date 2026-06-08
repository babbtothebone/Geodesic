import { describe, it, expect } from 'vitest';
import { renderSkillFileJson, renderSkillFileMd } from '../skill-file-writer.js';
import { makeSkillFile } from './fixtures.js';

describe('renderSkillFileJson', () => {
  it('produces valid JSON', () => {
    const output = renderSkillFileJson(makeSkillFile());
    expect((): void => { void JSON.parse(output); }).not.toThrow();
  });

  it('includes $schema field', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed['$schema']).toBe('https://geodesic.dev/schema/v1/skill-file.json');
  });

  it('serializes meta fields in snake_case', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const meta = parsed['meta'];
    expect(meta).toBeDefined();
    expect(meta?.['geode_version']).toBe('0.1.0');
    expect(meta?.['analyzed_at']).toBe('2026-04-27T09:00:00Z');
    expect(meta?.['analyst_id']).toBe('test@example.com');
    expect(meta?.['repo_commit']).toBe('abc1234');
    expect(meta?.['crystal_id']).toBeNull();
    expect(meta?.['analysis_duration_ms']).toBe(12500);
  });

  it('serializes stack fields in snake_case', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const stack = parsed['stack'];
    expect(stack?.['primary_language']).toBe('TypeScript');
    expect(stack?.['auth_strategy']).toBe('JWT + httponly cookie');
    expect(stack?.['is_monorepo']).toBe(false);
  });

  it('serializes topology with snake_case keys', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const topology = parsed['topology'] as Record<string, unknown[]>;
    expect(Array.isArray(topology['entry_points'])).toBe(true);
    expect(Array.isArray(topology['key_modules'])).toBe(true);
    const firstModule = topology['key_modules']?.[0] as Record<string, unknown> | undefined;
    expect(firstModule?.['imported_by_count']).toBe(12);
  });

  it('serializes apis with snake_case keys', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const apis = parsed['apis'] as Record<string, unknown[]>;
    const firstRoute = apis['internal']?.[0] as Record<string, unknown> | undefined;
    expect(firstRoute?.['auth_required']).toBe(false);
    expect(firstRoute?.['phi_adjacent']).toBe(false);
  });

  it('serializes phi_zones with snake_case keys and correct coordinates', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const zones = parsed['phi_zones'] as Array<Record<string, unknown>>;
    expect(zones).toHaveLength(1);
    const zone = zones[0];
    expect(zone).toBeDefined();
    expect(zone?.['file']).toBe('src/db/schema.ts');
    expect(zone?.['line_start']).toBe(45);
    expect(zone?.['line_end']).toBe(89);
    expect(zone?.['phi_field_count']).toBe(6);
  });

  it('serializes dev_hooks with snake_case keys', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const hooks = parsed['dev_hooks'];
    expect(hooks?.['add_api_route']).toBeDefined();
    expect(hooks?.['add_db_model']).toBeDefined();
    expect(hooks?.['add_migration']).toBeDefined();
    expect(hooks?.['add_middleware']).toBeDefined();
    expect(hooks?.['add_env_var']).toBeDefined();
  });

  it('serializes databases with snake_case keys', () => {
    const output = renderSkillFileJson(makeSkillFile());
    const parsed = JSON.parse(output) as Record<string, Record<string, unknown>>;
    const db = parsed['databases'];
    expect(db?.['migrations_tool']).toBe('Drizzle Kit');
    expect(db?.['migration_count']).toBe(5);
    expect(db?.['phi_tables_detected']).toBe(true);
    expect(db?.['connection_env_vars']).toEqual(['DATABASE_URL']);
  });
});

describe('renderSkillFileMd', () => {
  it('includes repo name in heading', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('my-app — Geodesic Skill File');
  });

  it('shows cold start when crystalId is null', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('cold start');
  });

  it('shows crystal ID when present', () => {
    const sf = makeSkillFile({ meta: { ...makeSkillFile().meta, crystalId: 'cryst-xyz' } });
    const output = renderSkillFileMd(sf);
    expect(output).toContain('Crystal: cryst-xyz');
  });

  it('renders stack section', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('## Stack');
    expect(output).toContain('TypeScript');
    expect(output).toContain('Hono 4');
    expect(output).toContain('Drizzle ORM');
  });

  it('renders entry points in architecture overview', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('src/index.ts');
    expect(output).toContain('http_server');
  });

  it('renders PHI zones with exact coordinates (Law 4)', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('⚠ PHI Zones');
    expect(output).toContain('src/db/schema.ts — Lines 45–89');
  });

  it('renders dev hooks for every hook type', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('### Add an API Route');
    expect(output).toContain('### Add a Database Model');
    expect(output).toContain('### Add a Migration');
    expect(output).toContain('### Add a Test');
    expect(output).toContain('### Add Middleware');
    expect(output).toContain('### Add an Environment Variable');
  });

  it('renders known quirks as numbered list', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('## Watch Out For');
    expect(output).toContain('1. Drizzle ORM requires');
  });

  it('renders required env vars table with is_secret column', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('DATABASE_URL');
    expect(output).toContain('JWT_SECRET');
  });

  it('renders missing env vars section', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('RESEND_API_KEY');
  });

  it('renders internal routes table', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('/api/auth/login');
    expect(output).toContain('/api/users/:id');
  });

  it('omits webhooks section when empty', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).not.toContain('### Webhooks');
  });

  it('renders infrastructure section', () => {
    const output = renderSkillFileMd(makeSkillFile());
    expect(output).toContain('## Infrastructure');
    expect(output).toContain('GitHub Actions');
  });
});

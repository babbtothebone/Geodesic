import { describe, it, expect } from 'vitest';
import { renderArchitectureMap } from '../arch-map-writer.js';
import { makeSynthesisResult, makeSkillFile } from './fixtures.js';
import type { SynthesisResult } from '@geodesic/types';

describe('renderArchitectureMap', () => {
  it('includes repo name in the heading', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('my-app — Architecture Map');
  });

  it('includes provider and model in the header line', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('anthropic (claude-sonnet-4-6)');
  });

  it('shows cold start when crystalId is null', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('Cold start');
  });

  it('shows crystal ID when present', () => {
    const result = renderArchitectureMap(makeSynthesisResult({ crystalId: 'cryst-abc123' }));
    expect(result).toContain('Crystal: cryst-abc123');
  });

  it('includes primary language in stack section', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('TypeScript');
  });

  it('includes framework when present', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('Hono 4');
  });

  it('includes the AI narrative in architecture overview section', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('## Architecture Overview');
    expect(result).toContain('layered architecture');
  });

  it('renders internal API routes table', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('Internal Routes');
    expect(result).toContain('POST');
    expect(result).toContain('/api/auth/login');
  });

  it('marks PHI-adjacent routes with warning', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('⚠ yes');
  });

  it('renders external services section', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('External Services');
    expect(result).toContain('Resend');
  });

  it('renders PHI zones with exact file and line coordinates (Law 4)', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('⚠ PHI Zones');
    expect(result).toContain('src/db/schema.ts — Lines 45–89');
  });

  it('includes protection missing in PHI zone block', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('encryption at rest');
  });

  it('includes attestation refs in PHI zone block', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('a3f2');
    expect(result).toContain('b1c9');
  });

  it('includes dev note in PHI zone block', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('hipaa-guard.ts');
  });

  it('renders database section when engines present', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('## Database');
    expect(result).toContain('PostgreSQL');
  });

  it('renders infrastructure section', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).toContain('## Infrastructure');
    expect(result).toContain('GitHub Actions');
  });

  it('omits PHI zones section when no PHI detected', () => {
    const sf = makeSkillFile({ phiZones: [] });
    const synthesis: SynthesisResult = makeSynthesisResult({ skillFile: sf });
    const result = renderArchitectureMap(synthesis);
    expect(result).not.toContain('PHI Zones');
  });

  it('omits API surface section when no routes or services', () => {
    const sf = makeSkillFile({
      apis: { internal: [], external: [], webhooks: [] },
    });
    const synthesis: SynthesisResult = makeSynthesisResult({ skillFile: sf });
    const result = renderArchitectureMap(synthesis);
    expect(result).not.toContain('API Surface');
  });

  it('omits webhook section when no webhooks exist', () => {
    const result = renderArchitectureMap(makeSynthesisResult());
    expect(result).not.toContain('Webhooks');
  });
});

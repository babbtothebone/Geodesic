import type { SynthesisResult, SkillFileJson, GapReport } from '@geodesic/types';

export function makeSkillFile(overrides: Partial<SkillFileJson> = {}): SkillFileJson {
  const base: SkillFileJson = {
    '$schema': 'https://geodesic.dev/schema/v1/skill-file.json',
    meta: {
      geodeVersion: '0.1.0',
      schemaVersion: '1',
      analyzedAt: '2026-04-27T09:00:00Z',
      analystId: 'test@example.com',
      repo: 'my-app',
      repoCommit: 'abc1234',
      crystalId: null,
      crystalMatchScore: null,
      analysisDurationMs: 12500,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    stack: {
      primaryLanguage: 'TypeScript',
      allLanguages: ['TypeScript', 'SQL'],
      runtime: 'Node.js 22 LTS',
      framework: 'Hono 4',
      secondaryFrameworks: [],
      orm: 'Drizzle ORM',
      authStrategy: 'JWT + httponly cookie',
      emailProvider: 'Resend',
      paymentProvider: null,
      deployment: 'Docker + Nginx',
      isMonorepo: false,
      monoRepoTool: null,
    },
    topology: {
      entryPoints: [
        { file: 'src/index.ts', type: 'http_server', description: 'Main Hono app server on port 3000' },
      ],
      layers: [
        { name: 'API Routes', path: 'src/routes', responsibility: 'HTTP request handling and input validation', keyFiles: ['src/routes/users.ts', 'src/routes/auth.ts'] },
        { name: 'Data Layer', path: 'src/db', responsibility: 'Database access via Drizzle ORM', keyFiles: ['src/db/schema.ts', 'src/db/index.ts'] },
      ],
      keyModules: [
        { name: 'auth middleware', path: 'src/middleware/auth.ts', purpose: 'JWT verification on protected routes', importedByCount: 12 },
      ],
      circularDependencies: [],
    },
    apis: {
      internal: [
        { method: 'POST', path: '/api/auth/login', file: 'src/routes/auth.ts', line: 14, authRequired: false, authMethod: null, phiAdjacent: false },
        { method: 'GET', path: '/api/users/:id', file: 'src/routes/users.ts', line: 22, authRequired: true, authMethod: 'JWT', phiAdjacent: true },
      ],
      external: [
        { service: 'Resend', baseUrlPattern: 'https://api.resend.com', authMethod: 'Bearer token', filesReferencing: ['src/services/email.ts'] },
      ],
      webhooks: [],
    },
    databases: {
      engines: ['PostgreSQL'],
      orm: 'Drizzle ORM',
      migrationsTool: 'Drizzle Kit',
      migrationCount: 5,
      schemaFiles: ['src/db/schema.ts'],
      connectionEnvVars: ['DATABASE_URL'],
      phiTablesDetected: true,
    },
    envVars: {
      required: [
        { name: 'DATABASE_URL', purpose: 'PostgreSQL connection string', isSecret: true },
        { name: 'JWT_SECRET', purpose: 'JWT signing key', isSecret: true },
      ],
      optional: [
        { name: 'PORT', purpose: 'HTTP server port', defaultDescribed: '3000' },
      ],
      missingFromExample: ['RESEND_API_KEY'],
    },
    patterns: {
      authFlow: 'POST /api/auth/login returns JWT in httponly cookie. Protected routes verify via auth middleware.',
      errorHandling: 'Centralized error handler in src/middleware/error.ts. All errors return { error: string } JSON.',
      testingApproach: 'Vitest for unit and integration tests. Database tests use a test SQLite instance.',
      logging: 'Console-based logging. No structured logger configured.',
      apiVersioning: null,
      rateLimiting: null,
    },
    phiZones: [
      {
        file: 'src/db/schema.ts',
        lineStart: 45,
        lineEnd: 89,
        phiFieldCount: 6,
        hipaaCategories: ['direct_identifier', 'quasi_identifier'],
        attestationRefs: ['a3f2', 'b1c9'],
        protectionPresent: ['access control middleware'],
        protectionMissing: ['encryption at rest', 'audit logging', 'field-level encryption'],
        devNote: 'Do not add new columns to the patients table without updating src/middleware/hipaa-guard.ts and adding an audit log call.',
      },
    ],
    devHooks: {
      addApiRoute: '1. Create src/routes/{name}.ts\n2. Import and register in src/index.ts\n3. Add auth middleware if protected\n4. Add test in src/routes/__tests__/',
      addDbModel: '1. Add table definition to src/db/schema.ts\n2. Run: npm run db:generate\n3. Apply: npm run db:migrate',
      addMigration: '1. Modify schema in src/db/schema.ts\n2. Run: npm run db:generate\n3. Review generated migration\n4. Apply: npm run db:migrate',
      addTest: '1. Create test file in src/__tests__/\n2. Import the module under test\n3. Run: npm test',
      addMiddleware: '1. Create src/middleware/{name}.ts\n2. Export a Hono middleware function\n3. Register in src/index.ts before routes that need it',
      addEnvVar: '1. Add to .env.example with a description comment\n2. Add to src/config.ts validation\n3. Document in README',
    },
    constraints: {
      knownQuirks: [
        'Drizzle ORM requires running db:generate after every schema change — forgetting this causes silent type mismatches at runtime.',
      ],
      breakingChangeRisks: [
        'Changing JWT_SECRET invalidates all existing sessions immediately.',
      ],
      techDebtHotspots: [
        'src/routes/users.ts (412 lines) — validation logic is duplicated across route handlers.',
      ],
    },
    infra: {
      containerized: true,
      orchestration: 'Docker Compose',
      ciCdTools: ['GitHub Actions'],
      deploymentTargets: ['VPS'],
      hasHealthCheck: false,
      hasMonitoring: false,
    },
    ...overrides,
  };
  return base;
}

export function makeGapReport(overrides: Partial<GapReport> = {}): GapReport {
  const base: GapReport = {
    repoName: 'my-app',
    analyzedAt: '2026-04-27T09:00:00Z',
    overallScore: 62,
    overallGrade: 'C',
    dimensions: [
      {
        dimension: 'Security',
        score: 70,
        grade: 'C',
        active: true,
        findings: [
          {
            severity: 'P1',
            dimension: 'Security',
            description: 'No rate limiting on auth endpoints',
            file: 'src/routes/auth.ts',
            lineStart: 1,
            lineEnd: 80,
            detail: 'No rate limiting configured on POST /api/auth/login.',
            fix: 'Add a rate limiter middleware (e.g. hono-rate-limiter) before the auth route.',
            deduction: 15,
          },
          {
            severity: 'P1',
            dimension: 'Security',
            description: 'No HTTPS enforcement found in config',
            file: 'src/index.ts',
            lineStart: 1,
            lineEnd: 40,
            detail: 'No redirect from HTTP to HTTPS found in application config.',
            fix: 'Configure HTTPS redirect in Nginx or add a middleware that rejects non-HTTPS requests.',
            deduction: 15,
          },
        ],
      },
      {
        dimension: 'Compliance',
        score: 50,
        grade: 'D',
        active: true,
        findings: [
          {
            severity: 'P0',
            dimension: 'Compliance',
            description: 'PHI fields stored without encryption at rest',
            file: 'src/db/schema.ts',
            lineStart: 45,
            lineEnd: 89,
            detail: 'PHI columns in patients table have no encryption at rest.',
            fix: 'Enable PostgreSQL column-level encryption or application-level encryption before storing PHI fields.',
            deduction: 30,
          },
          {
            severity: 'P0',
            dimension: 'Compliance',
            description: 'No audit log on PHI field access',
            file: 'src/db/schema.ts',
            lineStart: 45,
            lineEnd: 89,
            detail: 'No audit trail exists for reads or writes to PHI fields.',
            fix: 'Implement audit logging middleware that records every access to PHI fields with user ID, timestamp, and action.',
            deduction: 20,
          },
        ],
      },
      {
        dimension: 'Testability',
        score: 80,
        grade: 'B',
        active: true,
        findings: [
          {
            severity: 'P2',
            dimension: 'Testability',
            description: 'No integration tests',
            file: 'src/__tests__',
            lineStart: 1,
            lineEnd: 1,
            detail: 'Only unit tests found. No integration test suite covers the full HTTP layer.',
            fix: 'Add integration tests using supertest or a Hono test client that exercise the full route stack.',
            deduction: 15,
          },
        ],
      },
      {
        dimension: 'Observability',
        score: 65,
        grade: 'C',
        active: true,
        findings: [
          {
            severity: 'P1',
            dimension: 'Observability',
            description: 'No health check endpoint',
            file: 'src/index.ts',
            lineStart: 1,
            lineEnd: 40,
            detail: 'No /health or /ping endpoint found.',
            fix: 'Add GET /health that returns 200 OK with uptime and database connectivity status.',
            deduction: 20,
          },
        ],
      },
      {
        dimension: 'Maintainability',
        score: 90,
        grade: 'A',
        active: true,
        findings: [],
      },
      {
        dimension: 'Documentation',
        score: 75,
        grade: 'B',
        active: true,
        findings: [
          {
            severity: 'P2',
            dimension: 'Documentation',
            description: 'No API documentation',
            file: 'README.md',
            lineStart: 1,
            lineEnd: 1,
            detail: 'No OpenAPI spec or API README found.',
            fix: 'Add OpenAPI docs using @hono/swagger-ui or a separate API.md file.',
            deduction: 20,
          },
        ],
      },
      {
        dimension: 'Scalability',
        score: 80,
        grade: 'B',
        active: true,
        findings: [
          {
            severity: 'P2',
            dimension: 'Scalability',
            description: 'No caching layer for expensive operations',
            file: 'src/routes/users.ts',
            lineStart: 1,
            lineEnd: 412,
            detail: 'Database queries run on every request with no caching.',
            fix: 'Add Redis caching for frequently-read user data.',
            deduction: 10,
          },
        ],
      },
    ],
    uncertainDetections: [
      {
        entryId: 'd290',
        file: 'src/utils/logger.ts',
        lineStart: 88,
        lineEnd: 91,
        isApproximateRange: false,
        trigger: 'string pattern resembles email address in log output',
        confidencePct: 72,
        confidence: 'UNCERTAIN',
        attestationRef: 'd290',
        action: 'Open file, review lines 88–91. If PII confirmed: redact the log call and add the field to the PHI zone registry.',
        markedReviewed: false,
      },
    ],
    recommendedPathForward: 'Address the two P0 Compliance findings first — PHI encryption at rest and audit logging are HIPAA requirements that represent legal exposure. These should be fixed before any future deployment. Next, implement rate limiting on the auth endpoint and add HTTPS enforcement to close the P1 Security gaps. Add a health check endpoint to unblock monitoring setup. The remaining P2 findings (API docs, caching, integration tests) should be scheduled across the next two sprints.',
    ...overrides,
  };
  return base;
}

export function makeSynthesisResult(overrides: Partial<SynthesisResult> = {}): SynthesisResult {
  return {
    skillFile: makeSkillFile(),
    gapReport: makeGapReport(),
    architectureMapMarkdown: '## Topology\n\nThe application follows a layered architecture with HTTP routes in `src/routes/`, business logic isolated in services, and data access through Drizzle ORM models in `src/db/`.',
    synthesisTokensUsed: 15420,
    echoHintsApplied: 3,
    crystalId: null,
    ...overrides,
  };
}

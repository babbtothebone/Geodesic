import type { PiiCategory, PiiType, ScrubConfidence } from '@geodesic/types';
import type { HipaaIdentifierCategory } from '@geodesic/types';

export interface PatternDef {
  readonly id: string;
  readonly pattern: RegExp;
  readonly category: PiiCategory;
  readonly piiType: PiiType;
  readonly confidence: ScrubConfidence;
  readonly confidencePct: number;
  readonly hipaaIdentifier: HipaaIdentifierCategory | null;
  readonly hipaaSafeHarborItem: string | null;
  readonly description: string;
}

// ─── Category 1: PHI — Direct HIPAA Identifiers ──────────────────────────────

const PHI_DIRECT: PatternDef[] = [
  {
    id: 'phi-ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    category: 'PHI',
    piiType: 'SOCIAL_SECURITY_NUMBER',
    confidence: 'HIGH',
    confidencePct: 98,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '9',
    description: 'Social Security Number',
  },
  {
    id: 'phi-email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    category: 'PHI',
    piiType: 'EMAIL',
    confidence: 'HIGH',
    confidencePct: 97,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '5',
    description: 'Email address',
  },
  {
    id: 'phi-phone',
    pattern: /\b(\+1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
    category: 'PHI',
    piiType: 'PHONE_NUMBER',
    confidence: 'HIGH',
    confidencePct: 96,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '4',
    description: 'US phone number',
  },
  {
    id: 'phi-date',
    pattern: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g,
    category: 'PHI',
    piiType: 'DATE_EXCEPT_YEAR',
    confidence: 'HIGH',
    confidencePct: 92,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '3',
    description: 'Date (MM/DD/YYYY)',
  },
  {
    id: 'phi-date-iso',
    pattern: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g,
    category: 'PHI',
    piiType: 'DATE_EXCEPT_YEAR',
    confidence: 'LOW',
    confidencePct: 35,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '3',
    description: 'ISO date (YYYY-MM-DD)',
  },
  {
    id: 'phi-mrn',
    pattern: /\b(?:MRN|MR)[-:\s]?\d{5,}\b/gi,
    category: 'PHI',
    piiType: 'MEDICAL_RECORD_NUMBER',
    confidence: 'HIGH',
    confidencePct: 99,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '7',
    description: 'Medical record number',
  },
  {
    id: 'phi-hpbn',
    pattern: /\b(?:HPBN|BEN)[-:\s]?\d+\b/gi,
    category: 'PHI',
    piiType: 'HEALTH_PLAN_BENEFICIARY_NUMBER',
    confidence: 'HIGH',
    confidencePct: 99,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '8',
    description: 'Health plan beneficiary number',
  },
  {
    id: 'phi-vin',
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g,
    category: 'PHI',
    piiType: 'VEHICLE_IDENTIFIER',
    confidence: 'UNCERTAIN',
    confidencePct: 55,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '13',
    description: 'Vehicle VIN (17-char) — also matches base32/base36 IDs, enum keys, hash prefixes',
  },
  {
    id: 'phi-ipv4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    category: 'PHI',
    piiType: 'IP_ADDRESS',
    confidence: 'HIGH',
    confidencePct: 95,
    hipaaIdentifier: 'direct_identifier',
    hipaaSafeHarborItem: '14',
    description: 'IPv4 address',
  },
];

// ─── Category 2: PHI — Quasi-Identifiers ─────────────────────────────────────

const PHI_QUASI: PatternDef[] = [
  {
    id: 'phi-zip',
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
    category: 'PHI',
    piiType: 'ZIP_CODE',
    confidence: 'UNCERTAIN',
    confidencePct: 65,
    hipaaIdentifier: 'quasi_identifier',
    hipaaSafeHarborItem: null,
    description: 'ZIP code (5-digit or ZIP+4)',
  },
];

// ─── Category 3: PII — General Personal Information ──────────────────────────

const PII_GENERAL: PatternDef[] = [
  {
    id: 'pii-credit-card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    category: 'PII',
    piiType: 'CREDIT_CARD',
    confidence: 'HIGH',
    confidencePct: 97,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'Credit card number',
  },
  {
    id: 'pii-passport',
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
    category: 'PII',
    piiType: 'GOVERNMENT_ID',
    confidence: 'LOW',
    confidencePct: 58,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'Passport / government ID pattern',
  },
];

// ─── Category 4: Secrets and Credentials ─────────────────────────────────────

const SECRETS: PatternDef[] = [
  {
    id: 'secret-private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    category: 'SECRET',
    piiType: 'PRIVATE_KEY',
    confidence: 'HIGH',
    confidencePct: 100,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'PEM private key block',
  },
  {
    id: 'secret-aws-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    category: 'SECRET',
    piiType: 'AWS_ACCESS_KEY',
    confidence: 'HIGH',
    confidencePct: 100,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'AWS access key ID',
  },
  {
    id: 'secret-gh-token',
    pattern: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|ghs_[A-Za-z0-9]{36})\b/g,
    category: 'SECRET',
    piiType: 'GITHUB_TOKEN',
    confidence: 'HIGH',
    confidencePct: 100,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'GitHub personal access token',
  },
  {
    id: 'secret-jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/g,
    category: 'SECRET',
    piiType: 'JWT_TOKEN',
    confidence: 'HIGH',
    confidencePct: 99,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'JWT token (three base64url segments)',
  },
  {
    id: 'secret-bearer',
    pattern: /Bearer\s+[A-Za-z0-9\-_.]{20,}/g,
    category: 'SECRET',
    piiType: 'OAUTH_TOKEN',
    confidence: 'HIGH',
    confidencePct: 97,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'Bearer token in Authorization header',
  },
  {
    id: 'secret-connection-string',
    pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:[^@]+@[^\s"']+/gi,
    category: 'SECRET',
    piiType: 'CONNECTION_STRING',
    confidence: 'HIGH',
    confidencePct: 99,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'Database connection string with credentials',
  },
  {
    id: 'secret-high-entropy',
    // High-entropy strings ≥ 32 chars adjacent to secret-sounding variable names
    // Matches values like sk-ant-api03-..., sk-..., etc.
    pattern: /(?:sk|pk|api|token|secret|key)-[A-Za-z0-9\-_]{24,}/g,
    category: 'SECRET',
    piiType: 'API_KEY',
    confidence: 'HIGH',
    confidencePct: 95,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'API key (prefixed high-entropy string)',
  },
  {
    id: 'secret-anthropic-key',
    pattern: /\bsk-ant-api\d{2}-[A-Za-z0-9\-_]{90,}\b/g,
    category: 'SECRET',
    piiType: 'API_KEY',
    confidence: 'HIGH',
    confidencePct: 100,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'Anthropic API key',
  },
  {
    id: 'secret-openai-key',
    pattern: /\bsk-[A-Za-z0-9]{32,}\b/g,
    category: 'SECRET',
    piiType: 'API_KEY',
    confidence: 'HIGH',
    confidencePct: 97,
    hipaaIdentifier: null,
    hipaaSafeHarborItem: null,
    description: 'OpenAI-style API key',
  },
];

export const ALL_PATTERNS: readonly PatternDef[] = [
  ...SECRETS,    // Secrets first — highest confidence, specific
  ...PHI_DIRECT, // PHI direct identifiers
  ...PII_GENERAL,
  ...PHI_QUASI,  // Quasi-identifiers last — most likely false positives
];

// Patterns used by verifyPurity — only HIGH/MEDIUM confidence, which do not appear as bare
// numeric/short-alphanumeric JSON values (file sizes, line counts, port numbers, code tokens).
// UNCERTAIN and LOW patterns are scrubbed during the walk phase on string fields but are
// excluded from the raw-JSON purity check to avoid false-positive pipeline failures.
export const PURITY_PATTERNS: readonly PatternDef[] = ALL_PATTERNS.filter(
  p => p.confidence !== 'UNCERTAIN' && p.confidence !== 'LOW',
);

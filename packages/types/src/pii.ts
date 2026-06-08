import type { HarvestResult } from './harvest.js';

export type PiiCategory = 'PHI' | 'PII' | 'SECRET';

export type PiiType =
  | 'PERSON_NAME'
  | 'DATE_OF_BIRTH'
  | 'MEDICAL_RECORD_NUMBER'
  | 'HEALTH_PLAN_BENEFICIARY_NUMBER'
  | 'ACCOUNT_NUMBER'
  | 'CERTIFICATE_LICENSE_NUMBER'
  | 'VEHICLE_IDENTIFIER'
  | 'DEVICE_IDENTIFIER'
  | 'URL_WITH_PHI'
  | 'BIOMETRIC_IDENTIFIER'
  | 'PHOTO_REFERENCE'
  | 'GEOGRAPHIC_SUBDIVISION'
  | 'DATE_EXCEPT_YEAR'
  | 'PHONE_NUMBER'
  | 'FAX_NUMBER'
  | 'SOCIAL_SECURITY_NUMBER'
  | 'EMAIL'
  | 'IP_ADDRESS'
  | 'CREDIT_CARD'
  | 'BANK_ACCOUNT'
  | 'GOVERNMENT_ID'
  | 'ZIP_CODE'
  | 'AGE_OVER_89'
  | 'API_KEY'
  | 'PASSWORD'
  | 'PRIVATE_KEY'
  | 'OAUTH_TOKEN'
  | 'JWT_TOKEN'
  | 'CONNECTION_STRING'
  | 'AWS_ACCESS_KEY'
  | 'GITHUB_TOKEN'
  | 'POSSIBLE_PERSON_NAME'
  | 'POSSIBLE_DATE_OF_BIRTH'
  | 'POSSIBLE_ZIP_CODE'
  | 'POSSIBLE_IDENTIFIER'
  | 'POSSIBLE_EMAIL'
  | (string & Record<never, never>);

export type ScrubConfidence = 'HIGH' | 'MEDIUM' | 'UNCERTAIN' | 'LOW';

export type HipaaIdentifierCategory = 'direct_identifier' | 'quasi_identifier';

export interface AttestationEntry {
  entryId: string;
  chainSeq: number;
  prevHash: string;
  thisHash: string;
  detectedAt: string;
  analystId: string;
  repo: string;
  repoCommit: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  colStart: number | null;
  colEnd: number | null;
  piiCategory: PiiCategory;
  piiType: PiiType;
  hipaaIdentifier: HipaaIdentifierCategory | null;
  hipaaSafeHarborItem: string | null;
  scrubConfidence: ScrubConfidence;
  scrubAction: 'REPLACED_WITH_TOKEN';
  tokenPlaced: string;
  payloadHash: string;
}

export interface UncertainDetection {
  entryId: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  isApproximateRange: boolean;
  trigger: string;
  confidence: Extract<ScrubConfidence, 'UNCERTAIN' | 'LOW'>;
  confidencePct: number;
  attestationRef: string;
  recommendedAction: string;
  markedReviewed: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

// HarvestResult lives in harvest.ts. The type-only import at the top of this file is erased
// at compile time, so it creates no runtime dependency between the pii and harvest modules.
export interface InterceptResult {
  // Scrubbed harvest object (mutated in place from the input harvest). Strings flagged by the
  // detector have been replaced with attestation tokens. The caller should not retain a
  // reference to the original harvest after intercept() returns — they share structural identity.
  scrubbedHarvest: HarvestResult;
  // SHA-256 hash of the JSON-serialized scrubbed harvest, anchoring every attestation entry.
  payloadHash: string;
  attestationEntries: AttestationEntry[];
  uncertainDetections: UncertainDetection[];
  piiCount: number;
  phiCount: number;
  secretCount: number;
  purityVerified: boolean;
}

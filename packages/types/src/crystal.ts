import type { FindingSeverity, ScoringDimension } from './artifacts';

export type CrystalStatus = 'probation' | 'active' | 'deprecated';

export interface CrystalFitnessHistory {
  date: string;
  score: number;
  useCount: number;
}

export interface CrystalFitness {
  useCount: number;
  probationUses: number;
  successCount: number;
  avgTokenSavingsPct: number;
  fitnessScore: number;
  fitnessHistory: CrystalFitnessHistory[];
}

export interface StackPatterns {
  typicalEntryPoints: string[];
  typicalLayerStructure: string;
  typicalAuthPattern: string | null;
  typicalDbPattern: string | null;
  typicalTestPattern: string | null;
  typicalInfraPattern: string | null;
}

export interface CommonGap {
  dimension: ScoringDimension;
  gap: string;
  severity: FindingSeverity;
  frequency: number;
}

export interface Crystal {
  schemaVersion: '1';
  crystalId: string;
  stackFingerprint: string;
  status: CrystalStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  fitness: CrystalFitness;
  stackPatterns: StackPatterns;
  analysisSequence: string[];
  commonGaps: CommonGap[];
  bootstrapPrompt: string;
}

export interface CrystalQueryResult {
  crystal: Crystal | null;
  matchScore: number;
  matchType: 'exact' | 'fuzzy' | 'none';
}

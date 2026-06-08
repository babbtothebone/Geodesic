export type ProviderErrorCode =
  | 'AUTH_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_EXCEEDED'
  | 'NETWORK_ERROR'
  | 'COPILOT_UNAVAILABLE'
  | 'COPILOT_MODEL_NOT_FOUND'
  | 'COPILOT_REQUEST_FAILED'
  | 'UNKNOWN';

export class ProviderError extends Error {
  override readonly name = 'ProviderError';

  constructor(
    public readonly provider: string,
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class PurityCheckError extends Error {
  override readonly name = 'PurityCheckError';

  constructor(
    public readonly matchedPattern: string,
    public readonly position: number,
    public readonly fieldPath?: string,
    public readonly matchedValue?: string,
  ) {
    super(
      `Purity check failed: pattern '${matchedPattern}' matched at position ${String(position)}` +
        (fieldPath ? ` in field '${fieldPath}'` : '') +
        (matchedValue ? ` — value: '${matchedValue}'` : '') +
        '. No PII may pass to the AI or be written to Crystal Store.',
    );
  }
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export class HarvesterError extends Error {
  override readonly name = 'HarvesterError';

  constructor(
    public readonly repoPath: string,
    message: string,
  ) {
    super(message);
  }
}

export class AttestationError extends Error {
  override readonly name = 'AttestationError';
}

export class CrystalSyncError extends Error {
  override readonly name = 'CrystalSyncError';

  constructor(
    public readonly operation: 'pull' | 'push',
    message: string,
  ) {
    super(message);
  }
}

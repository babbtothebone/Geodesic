export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
}

export interface EmbeddingResult {
  embedding: number[];
  inputTokens: number;
}

export interface TokenCostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  approach: 'fast' | 'thorough';
}

export interface ProviderHealthCheck {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface AIProvider {
  readonly name: string;
  readonly defaultModel: string;

  complete(messages: Message[], options: CompletionOptions): Promise<CompletionResult>;

  embed(text: string): Promise<EmbeddingResult>;

  estimateCost(messages: Message[]): TokenCostEstimate;

  healthCheck(): Promise<ProviderHealthCheck>;
}

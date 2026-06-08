export interface AzureProviderConfig {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  embeddingDeploymentName?: string;
}

export interface CopilotProviderConfig {
  /** vscode.lm family, e.g. "claude-3.5-sonnet", "gpt-4o". */
  family?: string;
  /** vscode.lm vendor; defaults to "copilot". */
  vendor?: string;
  /** Optional max-tokens override; bridge passes through. */
  maxTokens?: number;
}

export interface OllamaProviderConfig {
  baseUrl?: string;
}

export interface AdvancedConfig {
  extendedThinking?: boolean;
  noCrystalSync?: boolean;
  maxConcurrentRepos?: number;
}

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'azure' | 'ollama' | 'copilot';

export interface GeodesicConfig {
  provider: ProviderName;
  apiKey?: string;
  model?: string;
  analystId: string;
  crystalStoreRepo?: string;
  crystalStoreToken?: string;
  outputDir?: string;
  /** Optional path to a Baseline JSON file for drift detection. */
  baselinePath?: string;
  azure?: AzureProviderConfig;
  ollama?: OllamaProviderConfig;
  copilot?: CopilotProviderConfig;
  advanced?: AdvancedConfig;
}

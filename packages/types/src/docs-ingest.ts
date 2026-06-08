/** Transition documents dropped by the user into <repo>/transition-docs/. */
export type DocsFolderStatus = 'missing' | 'empty' | 'ready';

export interface IngestedDoc {
  relativePath: string;
  sizeBytes: number;
  contents: string;
  isBinary: boolean;
}

export interface IngestedDocsBundle {
  folderPath: string;
  status: DocsFolderStatus;
  docs: IngestedDoc[];
  knownGaps: Array<{ title: string; reason: string; owner?: string }>;
}

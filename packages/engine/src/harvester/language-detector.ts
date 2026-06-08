import type { FileTreeNode, LanguageCount, LanguageInventory } from '@geodesic/types';

const SOURCE_LANGUAGES = new Set([
  'TypeScript', 'JavaScript', 'Python', 'Go', 'Rust',
  'Java', 'Kotlin', 'Ruby', 'PHP', 'C#', 'Swift',
]);

export function detectLanguages(files: FileTreeNode[]): LanguageInventory {
  const counts = new Map<string, number>();

  for (const file of files) {
    if (file.type !== 'file' || !file.language) continue;
    if (!SOURCE_LANGUAGES.has(file.language)) continue;
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }

  const all: LanguageCount[] = [...counts.entries()]
    .map(([language, fileCount]) => ({ language, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount);

  return {
    primary: all[0]?.language ?? 'Unknown',
    all,
  };
}

export function isSourceFile(file: FileTreeNode): boolean {
  return file.type === 'file' && file.language !== null && SOURCE_LANGUAGES.has(file.language);
}

export function filterSourceFiles(files: FileTreeNode[]): FileTreeNode[] {
  return files.filter(isSourceFile);
}

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

function runGit(repoPath: string, args: string): string | null {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git'));
}

export function getHeadCommit(repoPath: string): string | null {
  if (!isGitRepo(repoPath)) return null;
  return runGit(repoPath, 'rev-parse --short HEAD');
}

export function getRepoName(repoPath: string): string {
  // Try git remote first
  if (isGitRepo(repoPath)) {
    const remote = runGit(repoPath, 'remote get-url origin');
    if (remote) {
      // Strip trailing .git and take the last segment
      const cleaned = remote.replace(/\.git$/, '');
      const parts = cleaned.split(/[/\\:]/);
      const last = parts[parts.length - 1];
      if (last && last.trim()) return last.trim();
    }
  }

  // Fall back to directory name
  return path.basename(path.resolve(repoPath));
}

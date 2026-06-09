import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Runs `git -C <repoPath> <args...>` via execFileSync.
 *
 * SECURITY: uses execFileSync (not execSync) with an argument array so that none of
 * the inputs are interpreted by a shell. A malicious repo directory named e.g.
 * `; rm -rf ~` would have previously expanded inside the shell command string;
 * with execFileSync the path is passed as a single argv element and git receives
 * it verbatim, regardless of metacharacters.
 *
 * Returns the trimmed stdout, or null if git exits non-zero / times out / is missing.
 */
function runGit(repoPath: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
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
  return runGit(repoPath, ['rev-parse', '--short', 'HEAD']);
}

export function getRepoName(repoPath: string): string {
  // Try git remote first
  if (isGitRepo(repoPath)) {
    const remote = runGit(repoPath, ['remote', 'get-url', 'origin']);
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

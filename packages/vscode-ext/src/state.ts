import * as vscode from 'vscode';

export interface RepoEntry {
  path: string;
  label: string;
}

const REPOS_KEY = 'geodesic.repos';

export class ExtensionState implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly storage: vscode.Memento) {}

  getRepos(): RepoEntry[] {
    return this.storage.get<RepoEntry[]>(REPOS_KEY, []);
  }

  async addRepo(repoPath: string): Promise<void> {
    const repos = this.getRepos();
    if (repos.some(r => r.path === repoPath)) return;
    const label = repoPath.split(/[\\/]/).pop() ?? repoPath;
    repos.push({ path: repoPath, label });
    await this.storage.update(REPOS_KEY, repos);
    this._onDidChange.fire();
  }

  async removeRepo(repoPath: string): Promise<void> {
    const repos = this.getRepos().filter(r => r.path !== repoPath);
    await this.storage.update(REPOS_KEY, repos);
    this._onDidChange.fire();
  }

  async reorderRepos(repos: RepoEntry[]): Promise<void> {
    await this.storage.update(REPOS_KEY, repos);
    this._onDidChange.fire();
  }

  fireChange(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pullCrystals, pushCrystals } from '../github-sync.js';
import { makeCrystal } from './fixtures.js';

const execAsync = promisify(execFile);

// ─── Windows-safe cleanup ──────────────────────────────────────────────────────
// Git leaves readonly packed-objects on Windows; chmod before rm to avoid EPERM.

function safeRmDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  function makeWritable(d: string): void {
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        try { fs.chmodSync(p, 0o666); } catch { /* ignore */ }
        if (entry.isDirectory()) makeWritable(p);
      }
    } catch { /* ignore */ }
  }
  makeWritable(dir);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<void> {
  // GIT_CONFIG_NOSYSTEM + isolated HOME prevents user git config interference
  await execAsync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  });
}

async function initRepo(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  try { await git(['init', '-b', 'main'], dir); }
  catch { await git(['init'], dir); }
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
}

async function initBareRepo(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  try { await git(['init', '--bare', '-b', 'main'], dir); }
  catch { await git(['init', '--bare'], dir); }
}

// Seeds a bare repo with one commit so it has a valid HEAD to pull/push against.
async function seedBareWithCommit(bareDir: string, seedDir: string): Promise<void> {
  await initRepo(seedDir);
  await git(['remote', 'add', 'origin', bareDir], seedDir);
  fs.writeFileSync(path.join(seedDir, 'README.md'), '# Crystal Store\n', 'utf8');
  await git(['add', 'README.md'], seedDir);
  await git(['commit', '-m', 'init'], seedDir);
  try { await git(['push', '-u', 'origin', 'HEAD:main'], seedDir); }
  catch { await git(['push', '-u', 'origin', 'HEAD:master'], seedDir); }
  // seedDir cleanup is handled by afterEach via tmpRoot
}

// Sets up a local clone of bareDir with tracking branch ready for pull/push.
async function cloneLocal(bareDir: string, cloneDir: string): Promise<void> {
  await initRepo(cloneDir);
  await git(['remote', 'add', 'origin', bareDir], cloneDir);
  await git(['fetch', 'origin'], cloneDir);
  try { await git(['checkout', '-b', 'main', '--track', 'origin/main'], cloneDir); }
  catch { await git(['checkout', '-b', 'master', '--track', 'origin/master'], cloneDir); }
}

// ─── Crystal fixture ──────────────────────────────────────────────────────────

const FP = 'typescript+express+postgres+jwt+docker';

function writeCrystalFile(crystalsDir: string, fingerprint: string): void {
  const crystalDir = path.join(crystalsDir, fingerprint);
  fs.mkdirSync(crystalDir, { recursive: true });
  fs.writeFileSync(
    path.join(crystalDir, 'crystal.json'),
    JSON.stringify(makeCrystal({ stackFingerprint: fingerprint }), null, 2),
    'utf8',
  );
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-sync-'));
});

afterEach(() => {
  safeRmDir(tmpRoot);
});

// ─── pullCrystals ─────────────────────────────────────────────────────────────

describe('pullCrystals', () => {
  describe('crystals dir does not exist / not a git repo', () => {
    it('returns local-only message when no config is set', async () => {
      // Dir does not exist at all → fs.existsSync returns false → isGitRepo false
      const crystalsDir = path.join(tmpRoot, 'no-such-dir');
      const result = await pullCrystals(crystalsDir);
      expect(result.success).toBe(false);
      expect(result.requiresAction).toBe(false);
      expect(result.message).toMatch(/no Crystal Store configured/i);
    });

    it('clones from crystalStoreRepo when config is set', async () => {
      const bareDir = path.join(tmpRoot, 'bare.git');
      const seedDir = path.join(tmpRoot, 'seed');
      await initBareRepo(bareDir);
      await seedBareWithCommit(bareDir, seedDir);

      const crystalsDir = path.join(tmpRoot, 'crystals');
      const result = await pullCrystals(crystalsDir, { crystalStoreRepo: bareDir });

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/initialized/i);
      expect(fs.existsSync(crystalsDir)).toBe(true);
    }, 15_000);

    it('returns failure when clone URL is unreachable', async () => {
      const crystalsDir = path.join(tmpRoot, 'crystals');
      const result = await pullCrystals(crystalsDir, {
        crystalStoreRepo: 'https://github.com/xyz-nonexistent-999/no-such-repo.git',
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/failed to clone/i);
    }, 15_000);
  });

  describe('crystals dir is a git repo with no remote', () => {
    it('returns silent local-only success when no crystalStoreRepo in config', async () => {
      const crystalsDir = path.join(tmpRoot, 'crystals');
      await initRepo(crystalsDir);

      const result = await pullCrystals(crystalsDir);
      expect(result.success).toBe(true);
      expect(result.requiresAction).toBe(false);
      expect(result.message).toMatch(/local-only/i);
    });

    it('adds remote and pulls when crystalStoreRepo is configured', async () => {
      const bareDir = path.join(tmpRoot, 'bare.git');
      const seedDir = path.join(tmpRoot, 'seed');
      await initBareRepo(bareDir);
      await seedBareWithCommit(bareDir, seedDir);

      const crystalsDir = path.join(tmpRoot, 'crystals');
      await initRepo(crystalsDir);

      const result = await pullCrystals(crystalsDir, { crystalStoreRepo: bareDir });
      expect(result.success).toBe(true);
    }, 15_000);

    it('never writes the token into .git/config', async () => {
      const bareDir = path.join(tmpRoot, 'bare.git');
      const seedDir = path.join(tmpRoot, 'seed');
      await initBareRepo(bareDir);
      await seedBareWithCommit(bareDir, seedDir);

      const crystalsDir = path.join(tmpRoot, 'crystals');
      await initRepo(crystalsDir);

      await pullCrystals(crystalsDir, {
        crystalStoreRepo: bareDir,
        crystalStoreToken: 'supersecrettoken',
      });

      const gitConfig = fs.readFileSync(path.join(crystalsDir, '.git', 'config'), 'utf8');
      expect(gitConfig).not.toContain('supersecrettoken');
    }, 15_000);
  });

  describe('crystals dir is a git repo with remote already configured', () => {
    it('pulls successfully and reports updated', async () => {
      const bareDir = path.join(tmpRoot, 'bare.git');
      const seedDir = path.join(tmpRoot, 'seed');
      await initBareRepo(bareDir);
      await seedBareWithCommit(bareDir, seedDir);

      const crystalsDir = path.join(tmpRoot, 'crystals');
      await cloneLocal(bareDir, crystalsDir);

      const result = await pullCrystals(crystalsDir, { crystalStoreRepo: bareDir });
      expect(result.success).toBe(true);
    }, 15_000);

    it('returns non-fatal failure (no requiresAction) when remote is unreachable', async () => {
      const crystalsDir = path.join(tmpRoot, 'crystals');
      await initRepo(crystalsDir);
      await git(['remote', 'add', 'origin', 'https://github.com/nonexistent/repo.git'], crystalsDir);

      const result = await pullCrystals(crystalsDir, {
        crystalStoreRepo: 'https://github.com/nonexistent/repo.git',
      });
      expect(result.success).toBe(false);
      expect(result.requiresAction).toBe(false);
      expect(result.message).toMatch(/sync failed/i);
    }, 15_000);
  });
});

// ─── pushCrystals ─────────────────────────────────────────────────────────────

describe('pushCrystals', () => {
  it('returns skip when crystals dir does not exist', async () => {
    // No dir at all → isGitRepo returns false immediately
    const crystalsDir = path.join(tmpRoot, 'no-such-dir');
    const result = await pushCrystals(crystalsDir, makeCrystal({ stackFingerprint: FP }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not a git repository/i);
  });

  it('rejects invalid stack fingerprint (path traversal attempt)', async () => {
    const crystalsDir = path.join(tmpRoot, 'crystals');
    await initRepo(crystalsDir);
    const result = await pushCrystals(crystalsDir, makeCrystal({ stackFingerprint: '../../../etc/passwd' }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid fingerprint/i);
  });

  it('commits locally and returns local success when no remote is configured', async () => {
    const crystalsDir = path.join(tmpRoot, 'crystals');
    await initRepo(crystalsDir);
    writeCrystalFile(crystalsDir, FP);

    const result = await pushCrystals(crystalsDir, makeCrystal({ stackFingerprint: FP }));
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/local/i);

    // Verify the commit actually landed in the local repo
    const { stdout } = await execAsync('git', ['log', '--oneline'], { cwd: crystalsDir, encoding: 'utf8' });
    expect(stdout).toContain('crystal: update');
  });

  it('commits and pushes to a configured remote', async () => {
    const bareDir = path.join(tmpRoot, 'bare.git');
    const seedDir = path.join(tmpRoot, 'seed');
    await initBareRepo(bareDir);
    await seedBareWithCommit(bareDir, seedDir);

    const crystalsDir = path.join(tmpRoot, 'crystals');
    await cloneLocal(bareDir, crystalsDir);
    writeCrystalFile(crystalsDir, FP);

    const result = await pushCrystals(
      crystalsDir,
      makeCrystal({ stackFingerprint: FP }),
      { crystalStoreRepo: bareDir },
    );
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/synced|nothing/i);
  }, 15_000);

  it('second push of same crystal succeeds without error', async () => {
    const bareDir = path.join(tmpRoot, 'bare.git');
    const seedDir = path.join(tmpRoot, 'seed');
    await initBareRepo(bareDir);
    await seedBareWithCommit(bareDir, seedDir);

    const crystalsDir = path.join(tmpRoot, 'crystals');
    await cloneLocal(bareDir, crystalsDir);
    writeCrystalFile(crystalsDir, FP);

    const crystal = makeCrystal({ stackFingerprint: FP });
    await pushCrystals(crystalsDir, crystal, { crystalStoreRepo: bareDir });

    // Second push — fitness log always appends a new entry so a new commit is created;
    // the function succeeds regardless (either synced or nothing-to-sync).
    const result = await pushCrystals(crystalsDir, crystal, { crystalStoreRepo: bareDir });
    expect(result.success).toBe(true);
    expect(result.requiresAction).toBe(false);
  }, 15_000);

  it('tracks consecutive failures and sets requiresAction after 3 push failures', async () => {
    const crystalsDir = path.join(tmpRoot, 'crystals');
    await initRepo(crystalsDir);
    await git(['remote', 'add', 'origin', 'https://github.com/nonexistent/repo.git'], crystalsDir);

    const crystal = makeCrystal({ stackFingerprint: FP });
    const config = { crystalStoreRepo: 'https://github.com/nonexistent/repo.git' };

    // Push 1 and 2 — push fails, but requiresAction stays false
    for (let i = 0; i < 2; i++) {
      // Vary the crystal file so each run produces a new commit
      fs.mkdirSync(path.join(crystalsDir, FP), { recursive: true });
      fs.writeFileSync(
        path.join(crystalsDir, FP, 'crystal.json'),
        JSON.stringify({ ...crystal, updatedAt: new Date(Date.now() + i * 1000).toISOString() }, null, 2),
        'utf8',
      );
      const r = await pushCrystals(crystalsDir, crystal, config);
      expect(r.requiresAction).toBe(false);
    }

    // Push 3 — hits MAX_CONSECUTIVE_FAILURES, requiresAction becomes true
    fs.writeFileSync(
      path.join(crystalsDir, FP, 'crystal.json'),
      JSON.stringify({ ...crystal, updatedAt: new Date(Date.now() + 9999).toISOString() }, null, 2),
      'utf8',
    );
    const final = await pushCrystals(crystalsDir, crystal, config);
    expect(final.requiresAction).toBe(true);
    expect(final.message).toMatch(/failed \d+ times/i);
  }, 30_000);
});

// filepath: /Users/nicholasbabb/Desktop/Builds/geodesic-main/packages/engine/src/docs/__tests__/ingest.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectIngestedDocs,
  getDocsFolderStatus,
  getDocsFolderPath,
  setupDocsFolder,
  TRANSITION_DOCS_DIRNAME,
} from '../ingest.js';

describe('docs ingest', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'geodesic-docs-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  describe('getDocsFolderPath', () => {
    it('joins repo path with the transition-docs dirname', () => {
      expect(getDocsFolderPath(tmpRepo)).toBe(path.join(tmpRepo, TRANSITION_DOCS_DIRNAME));
    });
  });

  describe('getDocsFolderStatus', () => {
    it('returns "missing" when folder does not exist', () => {
      expect(getDocsFolderStatus(tmpRepo)).toBe('missing');
    });

    it('returns "empty" when folder exists but has only scaffolding', () => {
      setupDocsFolder(tmpRepo);
      expect(getDocsFolderStatus(tmpRepo)).toBe('empty');
    });

    it('returns "ready" when a real doc is dropped in', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, 'architecture.md'), '# Architecture\nReal content', 'utf8');
      expect(getDocsFolderStatus(tmpRepo)).toBe('ready');
    });

    it('treats .DS_Store and other scaffolding as not-ready', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, '.DS_Store'), 'macOS junk', 'utf8');
      expect(getDocsFolderStatus(tmpRepo)).toBe('empty');
    });

    it('treats unsupported extensions as not-ready', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, 'image.png'), 'fake png bytes', 'utf8');
      expect(getDocsFolderStatus(tmpRepo)).toBe('empty');
    });
  });

  describe('setupDocsFolder', () => {
    it('creates folder with README.md and .gitignore', () => {
      const { folderPath, created } = setupDocsFolder(tmpRepo);
      expect(created).toBe(true);
      expect(fs.existsSync(folderPath)).toBe(true);
      expect(fs.existsSync(path.join(folderPath, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(folderPath, '.gitignore'))).toBe(true);
    });

    it('is idempotent — second call reports created=false', () => {
      setupDocsFolder(tmpRepo);
      const second = setupDocsFolder(tmpRepo);
      expect(second.created).toBe(false);
    });

    it('does not overwrite a user-dropped doc on re-run', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      const docPath = path.join(folder, 'mine.md');
      fs.writeFileSync(docPath, '# Mine\nuser content', 'utf8');
      setupDocsFolder(tmpRepo);
      expect(fs.readFileSync(docPath, 'utf8')).toBe('# Mine\nuser content');
    });

    it('writes a README that mentions the transition-docs workflow', () => {
      const { folderPath } = setupDocsFolder(tmpRepo);
      const readme = fs.readFileSync(path.join(folderPath, 'README.md'), 'utf8');
      expect(readme.toLowerCase()).toContain('transition');
    });

    it('writes .gitignore that excludes contents by default', () => {
      const { folderPath } = setupDocsFolder(tmpRepo);
      const gi = fs.readFileSync(path.join(folderPath, '.gitignore'), 'utf8');
      expect(gi).toContain('*');
      expect(gi).toContain('!.gitignore');
      expect(gi).toContain('!README.md');
    });
  });

  describe('collectIngestedDocs', () => {
    it('returns missing status with no docs when folder absent', () => {
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.status).toBe('missing');
      expect(bundle.docs).toHaveLength(0);
      expect(bundle.folderPath).toBe(getDocsFolderPath(tmpRepo));
    });

    it('returns empty status when folder only has scaffolding', () => {
      setupDocsFolder(tmpRepo);
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.status).toBe('empty');
      expect(bundle.docs).toHaveLength(0);
    });

    it('reads a markdown file and reports it as ready', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, 'arch.md'), '# Title\nbody text', 'utf8');
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.status).toBe('ready');
      expect(bundle.docs).toHaveLength(1);
      const doc = bundle.docs[0]!;
      expect(doc.relativePath).toBe('arch.md');
      expect(doc.contents).toContain('Title');
      expect(doc.isBinary).toBe(false);
      expect(doc.sizeBytes).toBeGreaterThan(0);
    });

    it('reads multiple docs and sorts by relativePath', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, 'b.md'), 'B', 'utf8');
      fs.writeFileSync(path.join(folder, 'a.md'), 'A', 'utf8');
      fs.writeFileSync(path.join(folder, 'c.txt'), 'C', 'utf8');
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.docs.map(d => d.relativePath)).toEqual(['a.md', 'b.md', 'c.txt']);
    });

    it('recurses into subdirectories', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      const sub = path.join(folder, 'confluence-export');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'page-1.md'), 'page 1', 'utf8');
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.docs).toHaveLength(1);
      expect(bundle.docs[0]!.relativePath).toContain('confluence-export');
      expect(bundle.docs[0]!.relativePath).toContain('page-1.md');
    });

    it('skips README.md, .gitignore, and other scaffolding', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, 'real.md'), 'real', 'utf8');
      const bundle = collectIngestedDocs(tmpRepo);
      const names = bundle.docs.map(d => d.relativePath);
      expect(names).toContain('real.md');
      expect(names).not.toContain('README.md');
      expect(names).not.toContain('.gitignore');
    });

    it('skips files with unsupported extensions (.png, .zip, etc.)', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      fs.writeFileSync(path.join(folder, 'real.md'), 'real', 'utf8');
      fs.writeFileSync(path.join(folder, 'image.png'), 'png bytes', 'utf8');
      fs.writeFileSync(path.join(folder, 'archive.zip'), 'zip bytes', 'utf8');
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.docs.map(d => d.relativePath)).toEqual(['real.md']);
    });

    it('flags binary doc extensions (.pdf, .docx) as isBinary=true', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      // Write minimal PDF-ish bytes — we only care that the loader flags binary by extension
      fs.writeFileSync(path.join(folder, 'spec.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46]));
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.docs).toHaveLength(1);
      const doc = bundle.docs[0]!;
      expect(doc.relativePath).toBe('spec.pdf');
      expect(doc.isBinary).toBe(true);
    });

    it('parses _unreachable.md into knownGaps', () => {
      setupDocsFolder(tmpRepo);
      const folder = getDocsFolderPath(tmpRepo);
      const unreachable = [
        '# Known Gaps',
        '',
        '- title: Legacy auth wiki',
        '  reason: Confluence space deleted in 2024',
        '  owner: platform-team',
        '- title: Sunset payment processor',
        '  reason: No docs ever existed',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(folder, '_unreachable.md'), unreachable, 'utf8');
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.knownGaps.length).toBeGreaterThanOrEqual(2);
      const titles = bundle.knownGaps.map(g => g.title);
      expect(titles).toContain('Legacy auth wiki');
      expect(titles).toContain('Sunset payment processor');
      const legacy = bundle.knownGaps.find(g => g.title === 'Legacy auth wiki')!;
      expect(legacy.reason).toContain('Confluence');
      expect(legacy.owner).toBe('platform-team');
    });

    it('returns an empty knownGaps array when _unreachable.md is absent', () => {
      setupDocsFolder(tmpRepo);
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.knownGaps).toEqual([]);
    });

    it('returns an empty bundle when folder is missing — never throws', () => {
      // tmpRepo is a fresh dir with no transition-docs folder at all
      expect(() => collectIngestedDocs(tmpRepo)).not.toThrow();
      const bundle = collectIngestedDocs(tmpRepo);
      expect(bundle.docs).toEqual([]);
      expect(bundle.knownGaps).toEqual([]);
    });
  });
});

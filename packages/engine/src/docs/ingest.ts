/**
 * Docs Ingest — "drop your transition documents here" workflow.
 *
 * Lives at <repo>/transition-docs/. The folder contains a README that walks
 * users through exporting from Confluence (or anywhere else) and dropping
 * files into the folder. At scan time, every file under the folder is read,
 * normalized to text, and fed into the synthesis prompt alongside the
 * harvested code so the LLM can compare documented architecture vs. reality.
 *
 * No LLM call in this module — it's pure filesystem + parsing.
 */

import * as fs from 'fs';
import * as path from 'path';

export const TRANSITION_DOCS_DIRNAME = 'transition-docs';
const README_FILE = 'README.md';
const INDEX_FILE = '_index.json';
const UNREACHABLE_FILE = '_unreachable.md';

/** Files we treat as "the user dropped a real doc here." */
const DOC_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt',
  '.pdf', '.docx', '.doc', '.rtf',
  '.html', '.htm',
]);

/** Always ignored — these are scaffolding, not user-provided docs. */
const SCAFFOLDING_FILES = new Set([README_FILE, INDEX_FILE, UNREACHABLE_FILE, '.gitignore', '.DS_Store']);

import type { DocsFolderStatus, IngestedDoc, IngestedDocsBundle } from '@geodesic/types';
export type { DocsFolderStatus, IngestedDoc, IngestedDocsBundle };

export function getDocsFolderPath(repoPath: string): string {
  return path.join(repoPath, TRANSITION_DOCS_DIRNAME);
}

/**
 * Returns the current state of the docs folder for the given repo.
 * Used by the sidebar to decide whether to show "Set Up Docs Ingest"
 * or "Run Comparison".
 */
export function getDocsFolderStatus(repoPath: string): DocsFolderStatus {
  const folder = getDocsFolderPath(repoPath);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return 'missing';
  const dropped = listDocFiles(folder);
  return dropped.length === 0 ? 'empty' : 'ready';
}

/**
 * Creates `<repo>/transition-docs/` with a README that walks the user
 * through exporting from Confluence and dropping files in. Safe to call
 * repeatedly — won't overwrite existing user content.
 */
export function setupDocsFolder(repoPath: string): { folderPath: string; created: boolean } {
  const folder = getDocsFolderPath(repoPath);
  const created = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });

  // README — always rewrite, it's our content
  fs.writeFileSync(path.join(folder, README_FILE), renderReadme(), 'utf8');

  // _index.json — only seed if missing, user can edit
  const indexPath = path.join(folder, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, JSON.stringify(seedIndex(), null, 2) + '\n', 'utf8');
  }

  // _unreachable.md — only seed if missing
  const unreachablePath = path.join(folder, UNREACHABLE_FILE);
  if (!fs.existsSync(unreachablePath)) {
    fs.writeFileSync(unreachablePath, renderUnreachableTemplate(), 'utf8');
  }

  // .gitignore — prevents accidental commit of potentially sensitive enterprise docs
  const gitignorePath = path.join(folder, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      '# Transition documents may contain sensitive internal architecture — do not commit by default.\n' +
        '# If you want to commit specific files, add explicit !rules below.\n' +
        '*\n' +
        '!.gitignore\n' +
        '!README.md\n',
      'utf8',
    );
  }

  return { folderPath: folder, created };
}

/**
 * Reads every doc file in the folder and returns them as a bundle.
 * Markdown/text are read inline; binary formats (PDF, DOCX) are noted
 * but their content is left as a placeholder until a parser is added.
 */
export function collectIngestedDocs(repoPath: string): IngestedDocsBundle {
  const folderPath = getDocsFolderPath(repoPath);
  const status = getDocsFolderStatus(repoPath);

  if (status === 'missing') {
    return { folderPath, status, docs: [], knownGaps: [] };
  }

  const files = listDocFiles(folderPath);
  const docs: IngestedDoc[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(folderPath, filePath);
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isText = ext === '.md' || ext === '.markdown' || ext === '.txt' || ext === '.html' || ext === '.htm';

    if (isText) {
      const contents = fs.readFileSync(filePath, 'utf8');
      docs.push({ relativePath, sizeBytes: stat.size, contents, isBinary: false });
    } else {
      // Binary doc (PDF/DOCX/etc.) — we surface the filename so the LLM at least
      // knows it exists and can ask for it. Real extraction (pdftotext/pandoc)
      // is a future enhancement; users can always export to .md/.txt instead.
      docs.push({
        relativePath,
        sizeBytes: stat.size,
        contents: `[Binary document: ${relativePath} (${ext.slice(1).toUpperCase()}, ${String(stat.size)} bytes). ` +
          `For best results, export this as Markdown or plain text from the source system.]`,
        isBinary: true,
      });
    }
  }

  const knownGaps = readKnownGaps(folderPath);

  return { folderPath, status, docs, knownGaps };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function listDocFiles(folder: string): string[] {
  const out: string[] = [];
  walk(folder, folder, out);
  return out.sort();
}

function walk(root: string, dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SCAFFOLDING_FILES.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!DOC_EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
}

function readKnownGaps(folder: string): IngestedDocsBundle['knownGaps'] {
  const indexPath = path.join(folder, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { knownGaps?: IngestedDocsBundle['knownGaps'] };
    return Array.isArray(raw.knownGaps) ? raw.knownGaps : [];
  } catch {
    return [];
  }
}

function seedIndex(): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    source: '(describe where these docs came from — e.g. "Confluence space ENG/Transition")',
    exportedBy: '(your username or team)',
    pages: [
      // Example entry — users replace with their own
      // { id: 'arch-overview', title: 'Architecture Overview', file: 'architecture-overview.md',
      //   confluenceUrl: 'https://your-org.atlassian.net/wiki/...' }
    ],
    knownGaps: [
      // Example entry — users replace with their own
      // { title: 'Legacy Patient Ingest Pipeline',
      //   reason: 'Page restricted — owning team has not granted access',
      //   owner: 'data-platform@yourcompany.com' }
    ],
  };
}

function renderUnreachableTemplate(): string {
  return [
    '# Unreachable / Restricted Documents',
    '',
    'List any documents you know exist but could not access. Each entry becomes a',
    '**blind spot** in the final gap report — the analyst will see exactly which',
    'doors are closed and who owns them.',
    '',
    '## Format',
    '',
    '- **Title:** _short name of the doc or system it describes_',
    '- **Reason:** _why you could not get it (permission, broken link, no owner, etc.)_',
    '- **Owner:** _team or person who could grant access_',
    '',
    '## Entries',
    '',
    '_(none yet — add as you discover them, or edit `_index.json` `knownGaps` directly)_',
    '',
  ].join('\n');
}

function renderReadme(): string {
  return `# Transition Documents

This folder is where you drop architecture, migration, and design documents that
describe how this system is **supposed** to work. During a Geodesic scan, every
file in here is read alongside the code so the analysis can compare documented
architecture against the reality found in the codebase.

The output is a **drift report** that flags:
- Components/databases/APIs the docs describe but the code doesn't have
- Components/databases/APIs the code has but the docs don't mention
- Areas where docs and code disagree on configuration, ownership, or wiring
- **Blind spots** — documents you couldn't access (listed in \`_unreachable.md\`)

---

## How to populate this folder

### Option 1 — Export individual Confluence pages (most common)

For each Confluence page that's part of the lift-and-shift transition:

1. Open the page in Confluence.
2. Click the **⋯** menu (top-right) → **Export** → **Export as Word**
   (or **Export as PDF** if Word export is disabled).
3. Save the file directly into this folder. Keep the original page title as the
   filename — e.g. \`Architecture Overview.docx\`.

> Word format is preferred because it preserves heading hierarchy and converts
> cleanly to plain text. PDF works too but loses some structure.

### Option 2 — Export an entire Confluence space (admin only)

If you have **space admin** rights:

1. Space settings → **Content tools** → **Export**
2. Choose **HTML** (preserves links and attachments)
3. Unzip the export inside this folder

### Option 3 — Copy/paste into Markdown

For 5–10 critical pages, copy the body into a \`.md\` file. Fastest path; least
fidelity.

---

## Files Geodesic reads

| Extension | Status |
|---|---|
| \`.md\`, \`.markdown\`, \`.txt\` | ✅ Read inline, full text |
| \`.html\`, \`.htm\` | ✅ Read as text (HTML tags included) |
| \`.pdf\`, \`.docx\`, \`.doc\`, \`.rtf\` | ⚠️ Filename surfaced; export to Markdown for best results |
| Anything else | ❌ Ignored |

Subfolders are walked recursively, so feel free to organize as you see fit
(e.g. \`architecture/\`, \`apis/\`, \`runbooks/\`).

---

## Recording documents you couldn't get

When a page is restricted or the owning team hasn't responded, **don't skip it
silently** — add it to \`_unreachable.md\` (or to the \`knownGaps\` array in
\`_index.json\`). Geodesic will list every gap in the final report so leadership
sees exactly which docs are missing, not a sanitized "all good" summary.

---

## Privacy note

This folder ships with a \`.gitignore\` that excludes everything by default.
Transition docs frequently contain sensitive internal architecture — keep them
local unless you've explicitly cleared specific files for commit.

---

## Then what?

Once you've dropped at least one document in here, return to the Geodesic
sidebar in VS Code. The "Set Up Docs Ingest" button will have changed to
**Run Comparison**. Click it, and the next scan will include the docs as
context for the architectural analysis.
`;
}

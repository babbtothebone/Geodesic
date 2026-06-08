import * as fs from 'fs';
import * as path from 'path';
import type { EnvVarEntry, FileTreeNode } from '@geodesic/types';

const SECRET_PATTERNS = [
  /secret/i, /password/i, /passwd/i, /token/i, /key/i, /api_key/i, /apikey/i,
  /private/i, /credential/i, /auth/i, /signing/i, /cert/i, /passphrase/i,
  /webhook/i, /salt/i, /hmac/i,
];

const PURPOSE_MAP: Array<[RegExp, string]> = [
  [/database|db_url|postgres|mysql|mongo|redis|sqlite|turso|neon|planetscale/i, 'Database connection'],
  [/jwt|signing|token_secret|session_secret/i, 'JWT / session signing'],
  [/api_key|apikey|openai|anthropic|stripe|sendgrid|twilio|resend|mailgun/i, 'External API key'],
  [/aws|s3|gcs|azure|bucket|storage/i, 'Cloud / storage credential'],
  [/smtp|email|mail_host|sendmail/i, 'Email transport'],
  [/port$/i, 'Network port'],
  [/host$/i, 'Service host'],
  [/url$/i, 'Service URL'],
  [/secret$/i, 'Shared secret'],
  [/password|passwd/i, 'Password'],
  [/webhook/i, 'Webhook URL or secret'],
  [/sentry|datadog|newrelic|honeycomb|otel/i, 'Observability / error tracking'],
  [/oauth|client_id|client_secret/i, 'OAuth credential'],
  [/node_env|app_env|environment|rails_env|rack_env|django_env/i, 'Runtime environment flag'],
  [/log_level|debug/i, 'Logging configuration'],
];

function inferPurpose(name: string): string | null {
  for (const [pattern, purpose] of PURPOSE_MAP) {
    if (pattern.test(name)) return purpose;
  }
  return null;
}

function isSecret(name: string): boolean {
  return SECRET_PATTERNS.some(p => p.test(name));
}

function parseEnvLine(
  line: string,
  filePath: string,
  isTemplate: boolean,
): EnvVarEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  // KEY=value or KEY= or export KEY=value
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
  if (!match?.[1]) return null;

  const name = match[1];
  const rawValue = match[2] ?? '';
  const hasValue = rawValue.trim().length > 0;

  return {
    name,
    file: filePath,
    hasValue,
    isTemplate,
    inferredPurpose: inferPurpose(name),
    isSecret: isSecret(name),
  };
}

function collectFromEnvFile(
  repoPath: string,
  file: FileTreeNode,
): EnvVarEntry[] {
  const fullPath = path.join(repoPath, file.path);
  let content: string;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return [];
  }

  // .env.example / .env.template / .env.sample → isTemplate = true
  const isTemplate = /\.example$|\.template$|\.sample$|\.dist$/.test(file.name);

  return content
    .split('\n')
    .map(line => parseEnvLine(line, file.path, isTemplate))
    .filter((e): e is EnvVarEntry => e !== null);
}

function collectFromSourceFiles(
  repoPath: string,
  files: FileTreeNode[],
  knownNames: Set<string>,
): EnvVarEntry[] {
  const found: EnvVarEntry[] = [];

  // process.env.FOO, os.environ['FOO'], os.environ.get('FOO'), ENV['FOO']
  const patterns: RegExp[] = [
    /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]]/g,
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /os\.environ\.get\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g,
    /os\.environ\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]]/g,
    /ENV\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]]/g,
    /\bgetenv\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g,
  ];

  const sourceExts = new Set(['.ts', '.js', '.mjs', '.tsx', '.jsx', '.py', '.rb', '.go', '.php']);

  for (const file of files) {
    if (file.type !== 'file') continue;
    if (!sourceExts.has(path.extname(file.name))) continue;
    if (file.path.includes('node_modules')) continue;
    if (file.path.includes('.test.') || file.path.includes('.spec.')) continue;

    const fullPath = path.join(repoPath, file.path);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (!name || knownNames.has(name)) continue;
        knownNames.add(name);
        found.push({
          name,
          file: file.path,
          hasValue: false,
          isTemplate: false,
          inferredPurpose: inferPurpose(name),
          isSecret: isSecret(name),
        });
      }
    }
  }

  return found;
}

export function collectEnvVars(
  repoPath: string,
  files: FileTreeNode[],
): EnvVarEntry[] {
  const envFiles = files.filter(
    f =>
      f.type === 'file' &&
      (f.name.startsWith('.env') || f.name.endsWith('.env')),
  );

  const allEntries: EnvVarEntry[] = [];
  const knownNames = new Set<string>();

  for (const file of envFiles) {
    const entries = collectFromEnvFile(repoPath, file);
    for (const entry of entries) {
      if (!knownNames.has(entry.name)) {
        knownNames.add(entry.name);
        allEntries.push(entry);
      } else {
        // Already seen from another env file — skip duplicate
      }
    }
  }

  // Pick up vars referenced in source but not in any .env file
  const sourceEntries = collectFromSourceFiles(repoPath, files, knownNames);
  allEntries.push(...sourceEntries);

  return allEntries;
}

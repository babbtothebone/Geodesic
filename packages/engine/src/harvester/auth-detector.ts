import * as fs from 'fs';
import * as path from 'path';
import type { ApiRoute, AuthInventory, AuthPattern, AuthPatternType, DependencyManifest, FileTreeNode } from '@geodesic/types';

const JWT_DEP_SIGNALS = [
  'jsonwebtoken', 'jose', '@auth/core', 'next-auth', '@supabase/supabase-js',
  'passport-jwt', '@nestjs/jwt', 'pyjwt', 'python-jose', 'djangorestframework-simplejwt',
];

const SESSION_DEP_SIGNALS = [
  'express-session', 'cookie-session', 'iron-session', '@hono/session',
  'django.contrib.sessions', 'rack-session',
];

const OAUTH_DEP_SIGNALS = [
  'passport', 'passport-google-oauth20', 'passport-github2', '@auth/core',
  'next-auth', 'authlib', 'django-allauth', 'omniauth',
];

const APIKEY_DEP_SIGNALS = [
  'express-api-key', 'apikey', 'fastapi-key-auth',
];

const MAGIC_LINK_DEP_SIGNALS = [
  'magic', '@magic-sdk/admin', 'otplib', 'speakeasy',
];

const AUTH_MIDDLEWARE_PATTERNS: Record<AuthPatternType, RegExp[]> = {
  jwt: [
    /verify(?:Token|Jwt|Access)/i,
    /jwt\.verify/i,
    /bearer\s+token/i,
    /authorization.*bearer/i,
    /jose\.jwtVerify/i,
    /decode_jwt|verify_jwt/i,
  ],
  session: [
    /req\.session/i,
    /session\s*\[/i,
    /iron_session|ironSession/i,
    /request\.session/i,
  ],
  oauth: [
    /passport\.authenticate/i,
    /oauth2|oauth_token/i,
    /google\.oauth|github\.oauth/i,
    /authlib\.integrations/i,
  ],
  apikey: [
    /x-api-key/i,
    /api[_-]?key/i,
    /apiKey.*header/i,
  ],
  magic_link: [
    /magic\s*link/i,
    /passwordless/i,
    /otp\s*token/i,
    /one.time.password/i,
  ],
  unknown: [],
};

function readFile(repoPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, relativePath), 'utf-8');
  } catch {
    return null;
  }
}

function depSetFromManifests(manifests: DependencyManifest[]): Set<string> {
  return new Set(manifests.flatMap(m => m.dependencies.map(d => d.name.toLowerCase())));
}

function detectTypeFromDeps(deps: Set<string>): AuthPatternType | null {
  for (const sig of JWT_DEP_SIGNALS) {
    if (deps.has(sig.toLowerCase())) return 'jwt';
  }
  for (const sig of SESSION_DEP_SIGNALS) {
    if (deps.has(sig.toLowerCase())) return 'session';
  }
  for (const sig of OAUTH_DEP_SIGNALS) {
    if (deps.has(sig.toLowerCase())) return 'oauth';
  }
  for (const sig of MAGIC_LINK_DEP_SIGNALS) {
    if (deps.has(sig.toLowerCase())) return 'magic_link';
  }
  for (const sig of APIKEY_DEP_SIGNALS) {
    if (deps.has(sig.toLowerCase())) return 'apikey';
  }
  return null;
}

function scanFilesForAuthType(
  repoPath: string,
  files: FileTreeNode[],
): Map<AuthPatternType, string[]> {
  const result = new Map<AuthPatternType, string[]>();

  const codeExts = new Set(['.ts', '.js', '.mjs', '.tsx', '.jsx', '.py', '.rb', '.go', '.php', '.java', '.kt']);
  const candidateFiles = files.filter(
    f =>
      f.type === 'file' &&
      codeExts.has(path.extname(f.name)) &&
      !f.path.includes('node_modules') &&
      !f.path.includes('.test.') &&
      !f.path.includes('.spec.'),
  );

  for (const file of candidateFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    for (const [authType, patterns] of Object.entries(AUTH_MIDDLEWARE_PATTERNS) as [AuthPatternType, RegExp[]][]) {
      if (authType === 'unknown') continue;
      if (patterns.some(p => p.test(content))) {
        const existing = result.get(authType) ?? [];
        if (!existing.includes(file.path)) {
          existing.push(file.path);
          result.set(authType, existing);
        }
      }
    }
  }

  return result;
}

function detectNextAuthFiles(files: FileTreeNode[]): string[] {
  return files
    .filter(
      f =>
        f.type === 'file' &&
        (f.path.includes('auth') || f.name.includes('auth')) &&
        ['.ts', '.js'].includes(path.extname(f.name)),
    )
    .map(f => f.path);
}

function coversAllRoutes(authFiles: string[], routes: ApiRoute[]): boolean {
  if (routes.length === 0) return false;
  // Heuristic: if there's a middleware/guard file at the top level of the route tree
  const hasGlobalMiddleware = authFiles.some(
    f =>
      f.includes('middleware') ||
      f.includes('guard') ||
      f.includes('_middleware') ||
      f.includes('interceptor'),
  );
  if (hasGlobalMiddleware) return true;

  // If all routes report authRequired
  return routes.length > 0 && routes.every(r => r.authRequired);
}

export function detectAuth(
  repoPath: string,
  files: FileTreeNode[],
  manifests: DependencyManifest[],
  routes: ApiRoute[],
): AuthInventory {
  const deps = depSetFromManifests(manifests);
  const patterns: AuthPattern[] = [];
  const seen = new Set<AuthPatternType>();

  // Dep-based detection (highest confidence)
  const depType = detectTypeFromDeps(deps);
  if (depType && !seen.has(depType)) {
    seen.add(depType);
    const keyFiles = detectNextAuthFiles(files).filter(f =>
      f.toLowerCase().includes(depType),
    );
    patterns.push({
      type: depType,
      keyFiles,
      coversAllRoutes: coversAllRoutes(keyFiles, routes),
    });
  }

  // File-scan based detection
  const scanResults = scanFilesForAuthType(repoPath, files);
  for (const [authType, keyFiles] of scanResults) {
    if (seen.has(authType)) continue;
    seen.add(authType);
    patterns.push({
      type: authType,
      keyFiles,
      coversAllRoutes: coversAllRoutes(keyFiles, routes),
    });
  }

  if (patterns.length === 0) {
    patterns.push({
      type: 'unknown',
      keyFiles: [],
      coversAllRoutes: false,
    });
  }

  return { patterns };
}

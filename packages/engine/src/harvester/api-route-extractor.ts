import * as fs from 'fs';
import * as path from 'path';
import type { ApiRoute, DependencyManifest, FileTreeNode, FrameworkInventory, HttpMethod } from '@geodesic/types';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL'];

export function extractApiRoutes(
  repoPath: string,
  files: FileTreeNode[],
  framework: FrameworkInventory,
  manifests: DependencyManifest[],
): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const allDeps = new Set(manifests.flatMap(m => m.dependencies.map(d => d.name)));

  if (framework.all.includes('Next.js')) {
    routes.push(...extractNextJsRoutes(repoPath, files));
  }

  if (
    framework.all.some(f => ['Express', 'Hono', 'Fastify', 'NestJS'].includes(f)) ||
    allDeps.has('express') || allDeps.has('hono') || allDeps.has('fastify')
  ) {
    routes.push(...extractNodeRoutes(repoPath, files));
  }

  if (framework.all.includes('FastAPI') || allDeps.has('fastapi')) {
    routes.push(...extractFastApiRoutes(repoPath, files));
  }

  if (framework.all.includes('Django') || allDeps.has('django')) {
    routes.push(...extractDjangoRoutes(repoPath, files));
  }

  if (framework.all.includes('Rails') || allDeps.has('rails')) {
    routes.push(...extractRailsRoutes(repoPath, files));
  }

  if (framework.all.includes('Spring Boot')) {
    routes.push(...extractSpringRoutes(repoPath, files));
  }

  if (framework.all.includes('Laravel') || allDeps.has('laravel/framework')) {
    routes.push(...extractLaravelRoutes(repoPath, files));
  }

  return deduplicateRoutes(routes);
}

function readFile(repoPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, relativePath), 'utf-8');
  } catch {
    return null;
  }
}

function extractNextJsRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];

  // pages/api/** — each file is a route
  const pagesApiFiles = files.filter(
    f => f.type === 'file' && f.path.includes('pages/api/') &&
    ['.ts', '.js', '.tsx', '.jsx'].includes(path.extname(f.name)),
  );

  for (const file of pagesApiFiles) {
    const routePath = '/' + file.path
      .replace(/^.*pages\/api\//, 'api/')
      .replace(/\.(ts|js|tsx|jsx)$/, '')
      .replace(/\/index$/, '');

    const content = readFile(repoPath, file.path);
    const methods = detectNextPagesApiMethods(content ?? '');

    for (const method of methods) {
      routes.push({
        method,
        path: routePath,
        file: file.path,
        line: 1,
        authRequired: detectAuthMiddleware(content ?? ''),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  // app/**/route.ts — App Router
  const appRouteFiles = files.filter(
    f => f.type === 'file' &&
    f.path.includes('/app/') &&
    (f.name === 'route.ts' || f.name === 'route.js'),
  );

  for (const file of appRouteFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    const routePath = '/' + file.path
      .replace(/^.*\/app\//, '')
      .replace(/\/route\.(ts|js)$/, '')
      .replace(/\(.*?\)\//g, ''); // remove route groups

    const exportedMethods = detectAppRouterMethods(content);
    for (const method of exportedMethods) {
      routes.push({
        method,
        path: routePath,
        file: file.path,
        line: findMethodLine(content, method),
        authRequired: detectAuthMiddleware(content),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  return routes;
}

function extractNodeRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const routePattern = /(?:app|router|server)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  const routeFiles = files.filter(f =>
    f.type === 'file' &&
    ['.ts', '.js', '.mjs'].includes(path.extname(f.name)) &&
    !f.path.includes('node_modules') &&
    !f.path.includes('.test.') && !f.path.includes('.spec.'),
  );

  for (const file of routeFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    // Only process files that look like they contain route definitions
    if (!routePattern.test(content)) continue;
    routePattern.lastIndex = 0;

    const lines = content.split('\n');
    let match: RegExpExecArray | null;
    while ((match = routePattern.exec(content)) !== null) {
      const method = (match[1] ?? 'get').toUpperCase() as HttpMethod;
      const routePath = match[2] ?? '/';
      const lineNum = getLineNumber(content, match.index);

      routes.push({
        method: HTTP_METHODS.includes(method) ? method : 'GET',
        path: routePath,
        file: file.path,
        line: lineNum,
        authRequired: detectAuthMiddleware(lines.slice(lineNum - 3, lineNum + 3).join('\n')),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  return routes;
}

function extractFastApiRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const pattern = /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;

  const pyFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.py'));

  for (const file of pyFiles) {
    const content = readFile(repoPath, file.path);
    if (!content || !content.includes('@')) continue;

    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      const method = (match[1] ?? 'get').toUpperCase() as HttpMethod;
      routes.push({
        method: HTTP_METHODS.includes(method) ? method : 'GET',
        path: match[2] ?? '/',
        file: file.path,
        line: getLineNumber(content, match.index),
        authRequired: detectPythonAuthDep(content),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  return routes;
}

function extractDjangoRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const urlFiles = files.filter(f => f.type === 'file' && f.name === 'urls.py');
  const pattern = /(?:path|re_path)\s*\(\s*['"]([^'"]+)['"]/g;

  for (const file of urlFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      routes.push({
        method: 'ALL',
        path: '/' + (match[1] ?? ''),
        file: file.path,
        line: getLineNumber(content, match.index),
        authRequired: content.includes('login_required') || content.includes('IsAuthenticated'),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  return routes;
}

function extractRailsRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const routesFile = files.find(f => f.path.includes('config/routes.rb'));
  if (!routesFile) return routes;

  const content = readFile(repoPath, routesFile.path);
  if (!content) return routes;

  const pattern = /(?:get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const method = (match[0].split(/\s/)[0] ?? 'get').toUpperCase() as HttpMethod;
    routes.push({
      method: HTTP_METHODS.includes(method) ? method : 'GET',
      path: match[1] ?? '/',
      file: routesFile.path,
      line: getLineNumber(content, match.index),
      authRequired: false,
      authMethod: null,
      middlewareChain: [],
    });
  }

  // resources declarations
  const resourcePattern = /resources?\s+:(\w+)/g;
  let rmatch: RegExpExecArray | null;
  while ((rmatch = resourcePattern.exec(content)) !== null) {
    const resource = rmatch[1] ?? 'resource';
    const base = `/${resource}`;
    const line = getLineNumber(content, rmatch.index);
    for (const [method, routePath] of [
      ['GET', base] as const, ['POST', base] as const,
      ['GET', `${base}/:id`] as const, ['PUT', `${base}/:id`] as const,
      ['PATCH', `${base}/:id`] as const, ['DELETE', `${base}/:id`] as const,
    ]) {
      routes.push({ method, path: routePath, file: routesFile.path, line, authRequired: false, authMethod: null, middlewareChain: [] });
    }
  }

  return routes;
}

function extractSpringRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const javaFiles = files.filter(
    f => f.type === 'file' && (f.name.endsWith('.java') || f.name.endsWith('.kt')),
  );

  const mappingPattern = /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\([^)]*value\s*=\s*)?['"]([^'"]+)['"]/g;

  for (const file of javaFiles) {
    const content = readFile(repoPath, file.path);
    if (!content || !content.includes('Mapping')) continue;

    let match: RegExpExecArray | null;
    const regex = new RegExp(mappingPattern.source, mappingPattern.flags);
    while ((match = regex.exec(content)) !== null) {
      const annotation = match[1] ?? 'Request';
      const method: HttpMethod = annotation === 'Request' ? 'ALL' :
        (annotation.toUpperCase() as HttpMethod);
      routes.push({
        method: HTTP_METHODS.includes(method) ? method : 'ALL',
        path: match[2] ?? '/',
        file: file.path,
        line: getLineNumber(content, match.index),
        authRequired: content.includes('@Secured') || content.includes('@PreAuthorize'),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  return routes;
}

function extractLaravelRoutes(repoPath: string, files: FileTreeNode[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const routeFiles = files.filter(
    f => f.type === 'file' && f.name.endsWith('.php') &&
    (f.path.includes('routes/api') || f.path.includes('routes/web')),
  );

  const pattern = /Route::(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;

  for (const file of routeFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      const method = (match[1] ?? 'get').toUpperCase() as HttpMethod;
      routes.push({
        method: HTTP_METHODS.includes(method) ? method : 'GET',
        path: match[2] ?? '/',
        file: file.path,
        line: getLineNumber(content, match.index),
        authRequired: content.includes('->middleware(\'auth\')') || content.includes('auth:'),
        authMethod: null,
        middlewareChain: [],
      });
    }
  }

  return routes;
}

function detectNextPagesApiMethods(content: string): HttpMethod[] {
  if (!content) return ['ALL'];
  const methods: HttpMethod[] = [];
  const methodPattern = /req\.method\s*===?\s*['"](\w+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = methodPattern.exec(content)) !== null) {
    const m = (match[1] ?? '').toUpperCase() as HttpMethod;
    if (HTTP_METHODS.includes(m)) methods.push(m);
  }
  return methods.length > 0 ? methods : ['ALL'];
}

function detectAppRouterMethods(content: string): HttpMethod[] {
  const found: HttpMethod[] = [];
  for (const method of HTTP_METHODS) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(content)) {
      found.push(method);
    }
  }
  return found.length > 0 ? found : ['ALL'];
}

function detectAuthMiddleware(content: string): boolean {
  return (
    content.includes('auth') && (
      content.includes('middleware') ||
      content.includes('guard') ||
      content.includes('verify') ||
      content.includes('authenticate')
    )
  );
}

function detectPythonAuthDep(content: string): boolean {
  return content.includes('Depends') && (
    content.includes('current_user') ||
    content.includes('oauth2_scheme') ||
    content.includes('get_current_user')
  );
}

function findMethodLine(content: string, method: string): number {
  const lines = content.split('\n');
  const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i] ?? '')) return i + 1;
  }
  return 1;
}

function getLineNumber(content: string, charIndex: number): number {
  return content.slice(0, charIndex).split('\n').length;
}

function deduplicateRoutes(routes: ApiRoute[]): ApiRoute[] {
  const seen = new Set<string>();
  return routes.filter(r => {
    const key = `${r.method}:${r.path}:${r.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

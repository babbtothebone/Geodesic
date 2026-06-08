import type { DependencyManifest, FileTreeNode, FrameworkInventory } from '@geodesic/types';

const JS_FRAMEWORK_MAP: Record<string, string> = {
  next: 'Next.js',
  '@remix-run/node': 'Remix',
  '@remix-run/react': 'Remix',
  nuxt: 'Nuxt',
  '@sveltejs/kit': 'SvelteKit',
  astro: 'Astro',
  express: 'Express',
  hono: 'Hono',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  '@trpc/server': 'tRPC',
  electron: 'Electron',
};

const PY_FRAMEWORK_MAP: Record<string, string> = {
  fastapi: 'FastAPI',
  django: 'Django',
  flask: 'Flask',
  sqlmodel: 'SQLModel',
  starlette: 'Starlette',
};

const PHP_FRAMEWORK_MAP: Record<string, string> = {
  'laravel/framework': 'Laravel',
  'symfony/framework-bundle': 'Symfony',
  'slim/slim': 'Slim',
};

const RUBY_FRAMEWORK_MAP: Record<string, string> = {
  rails: 'Rails',
  sinatra: 'Sinatra',
};

const JAVA_DEP_SIGNALS: Array<{ pattern: string; name: string }> = [
  { pattern: 'spring-boot-starter', name: 'Spring Boot' },
  { pattern: 'quarkus', name: 'Quarkus' },
  { pattern: 'micronaut', name: 'Micronaut' },
];

const MONOREPO_SIGNALS: Record<string, string> = {
  'turbo.json': 'Turborepo',
  'nx.json': 'Nx',
  'lerna.json': 'Lerna',
  'pnpm-workspace.yaml': 'pnpm workspaces',
  'pnpm-workspace.yml': 'pnpm workspaces',
};

export function detectFrameworks(
  manifests: DependencyManifest[],
  files: FileTreeNode[],
): FrameworkInventory {
  const found = new Set<string>();
  const allDeps = manifests.flatMap(m => m.dependencies);

  for (const dep of allDeps) {
    const jsMatch = JS_FRAMEWORK_MAP[dep.name];
    if (jsMatch) { found.add(jsMatch); continue; }

    const pyMatch = PY_FRAMEWORK_MAP[dep.name];
    if (pyMatch) { found.add(pyMatch); continue; }

    const phpMatch = PHP_FRAMEWORK_MAP[dep.name];
    if (phpMatch) { found.add(phpMatch); continue; }

    const rubyMatch = RUBY_FRAMEWORK_MAP[dep.name];
    if (rubyMatch) { found.add(rubyMatch); continue; }

    for (const signal of JAVA_DEP_SIGNALS) {
      if (dep.name.includes(signal.pattern)) {
        found.add(signal.name);
        break;
      }
    }
  }

  const fileNameSet = new Set(files.map(f => f.name));

  let isMonorepo = false;
  let monoRepoTool: string | null = null;

  for (const [signal, tool] of Object.entries(MONOREPO_SIGNALS)) {
    if (fileNameSet.has(signal)) {
      isMonorepo = true;
      monoRepoTool = tool;
      break;
    }
  }

  // npm/yarn workspaces: multiple package.json at different depths
  const pkgJsonCount = manifests.filter(m => m.type === 'package.json').length;
  if (pkgJsonCount > 2 && !isMonorepo) {
    isMonorepo = true;
    monoRepoTool = monoRepoTool ?? 'npm workspaces';
  }

  const all = [...found];

  return { primary: all[0] ?? null, all, isMonorepo, monoRepoTool };
}

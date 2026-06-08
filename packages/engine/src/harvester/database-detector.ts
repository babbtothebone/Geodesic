import * as fs from 'fs';
import * as path from 'path';
import type { DatabaseInventory, DependencyManifest, FileTreeNode } from '@geodesic/types';

const ORM_DEP_MAP: Record<string, string> = {
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle',
  typeorm: 'TypeORM',
  sequelize: 'Sequelize',
  mongoose: 'Mongoose',
  '@mikro-orm/core': 'MikroORM',
  sqlalchemy: 'SQLAlchemy',
  alembic: 'Alembic',
  'django.db': 'Django ORM',
  hibernate: 'Hibernate',
  'spring-data-jpa': 'Spring Data JPA',
  'laravel/framework': 'Eloquent',
  'doctrine/orm': 'Doctrine',
};

const MIGRATION_TOOL_MAP: Record<string, string> = {
  prisma: 'Prisma Migrate',
  'drizzle-kit': 'Drizzle Kit',
  alembic: 'Alembic',
  'db-migrate': 'db-migrate',
  knex: 'Knex',
  'typeorm': 'TypeORM migrations',
  flyway: 'Flyway',
  liquibase: 'Liquibase',
};

const MIGRATION_DIRS = ['migrations', 'db/migrate', 'database/migrations', 'alembic/versions'];

const DB_ENGINE_SIGNALS: Record<string, string> = {
  postgresql: 'PostgreSQL', postgres: 'PostgreSQL', pg: 'PostgreSQL',
  mysql: 'MySQL', mariadb: 'MariaDB',
  sqlite: 'SQLite', 'better-sqlite3': 'SQLite', '@libsql/client': 'SQLite/libSQL',
  mongodb: 'MongoDB', mongoose: 'MongoDB',
  redis: 'Redis', ioredis: 'Redis',
  'elasticsearch': 'Elasticsearch',
  cassandra: 'Cassandra',
  dynamodb: 'DynamoDB',
};

const CONNECTION_ENV_NAMES = [
  'DATABASE_URL', 'DB_URL', 'POSTGRES_URL', 'POSTGRES_URI',
  'MYSQL_URL', 'MONGODB_URI', 'MONGO_URL', 'REDIS_URL', 'REDIS_URI',
  'DATABASE_HOST', 'DB_HOST', 'DATABASE_NAME', 'DB_NAME',
  'TURSO_DATABASE_URL', 'PLANETSCALE_URL', 'NEON_DATABASE_URL',
];

export function detectDatabases(
  repoPath: string,
  files: FileTreeNode[],
  manifests: DependencyManifest[],
): DatabaseInventory {
  const engines = detectEngines(manifests, files, repoPath);
  const orm = detectOrm(manifests, files);
  const migrationsTool = detectMigrationsTool(manifests, files);
  const migrationCount = countMigrations(repoPath, files);
  const schemaFiles = findSchemaFiles(files);
  const connectionEnvVars = detectConnectionEnvVars(repoPath, files);

  return {
    engines: [...new Set(engines)],
    orm,
    migrationsTool,
    migrationCount,
    schemaFiles,
    connectionEnvVars,
  };
}

function detectEngines(
  manifests: DependencyManifest[],
  files: FileTreeNode[],
  repoPath: string,
): string[] {
  const found: string[] = [];
  const allDeps = manifests.flatMap(m => m.dependencies.map(d => d.name.toLowerCase()));

  for (const dep of allDeps) {
    for (const [signal, engine] of Object.entries(DB_ENGINE_SIGNALS)) {
      if (dep === signal || dep.includes(signal)) {
        found.push(engine);
      }
    }
  }

  // Check Prisma schema for datasource
  const prismaSchema = files.find(f => f.name === 'schema.prisma');
  if (prismaSchema) {
    const content = readFile(repoPath, prismaSchema.path);
    if (content) {
      const providerMatch = /provider\s*=\s*["'](\w+)["']/.exec(content);
      if (providerMatch?.[1]) {
        const provider = providerMatch[1].toLowerCase();
        if (provider === 'postgresql' || provider === 'postgres') found.push('PostgreSQL');
        else if (provider === 'mysql') found.push('MySQL');
        else if (provider === 'sqlite') found.push('SQLite');
        else if (provider === 'mongodb') found.push('MongoDB');
      }
    }
  }

  return found;
}

function detectOrm(manifests: DependencyManifest[], files: FileTreeNode[]): string | null {
  const allDeps = manifests.flatMap(m => m.dependencies.map(d => d.name));

  for (const dep of allDeps) {
    const orm = ORM_DEP_MAP[dep];
    if (orm) return orm;
  }

  // Framework-implied ORMs
  const hasPrismaSchema = files.some(f => f.name === 'schema.prisma');
  if (hasPrismaSchema) return 'Prisma';

  const hasDrizzleConfig = files.some(
    f => f.name === 'drizzle.config.ts' || f.name === 'drizzle.config.js',
  );
  if (hasDrizzleConfig) return 'Drizzle';

  return null;
}

function detectMigrationsTool(
  manifests: DependencyManifest[],
  files: FileTreeNode[],
): string | null {
  const allDeps = manifests.flatMap(m => m.dependencies.map(d => d.name.toLowerCase()));

  for (const [dep, tool] of Object.entries(MIGRATION_TOOL_MAP)) {
    if (allDeps.some(d => d === dep || d.includes(dep))) return tool;
  }

  // Rails migrations
  if (files.some(f => f.path.includes('db/migrate/'))) return 'Rails ActiveRecord';

  // Alembic (Python)
  if (files.some(f => f.name === 'alembic.ini')) return 'Alembic';

  return null;
}

function countMigrations(repoPath: string, files: FileTreeNode[]): number {
  let count = 0;
  for (const migDir of MIGRATION_DIRS) {
    count += files.filter(
      f => f.type === 'file' &&
      f.path.includes(migDir) &&
      (f.name.endsWith('.sql') || f.name.endsWith('.ts') || f.name.endsWith('.js') ||
       f.name.endsWith('.py') || f.name.endsWith('.rb')),
    ).length;
  }
  return count;
}

function findSchemaFiles(files: FileTreeNode[]): string[] {
  const schemaPatterns = [
    (f: FileTreeNode) => f.name === 'schema.prisma',
    (f: FileTreeNode) => f.name === 'schema.sql',
    (f: FileTreeNode) => f.name === 'schema.rb',
    (f: FileTreeNode) => f.name.endsWith('.sql') && f.path.includes('schema'),
    (f: FileTreeNode) => f.name === 'db.ts' || f.name === 'db.js',
    (f: FileTreeNode) => f.path.includes('prisma/') && f.name.endsWith('.prisma'),
  ];

  return files
    .filter(f => f.type === 'file' && schemaPatterns.some(p => p(f)))
    .map(f => f.path);
}

function detectConnectionEnvVars(repoPath: string, files: FileTreeNode[]): string[] {
  const found = new Set<string>();
  const envFiles = files.filter(
    f => f.type === 'file' && (f.name.startsWith('.env') || f.name.endsWith('.env')),
  );

  for (const file of envFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;
    for (const envName of CONNECTION_ENV_NAMES) {
      if (content.includes(envName)) found.add(envName);
    }
  }

  // Also check source files for process.env references
  const configFiles = files.filter(
    f => f.type === 'file' && (f.name.includes('database') || f.name.includes('db')) &&
    ['.ts', '.js', '.py', '.rb'].includes(path.extname(f.name)),
  );

  for (const file of configFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;
    for (const envName of CONNECTION_ENV_NAMES) {
      if (content.includes(envName)) found.add(envName);
    }
  }

  return [...found];
}

function readFile(repoPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, relativePath), 'utf-8');
  } catch {
    return null;
  }
}

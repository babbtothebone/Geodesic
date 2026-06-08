import type { DependencyManifest, FileTreeNode, TestInventory } from '@geodesic/types';

const TEST_FRAMEWORK_DEPS: Record<string, string> = {
  jest: 'Jest',
  vitest: 'Vitest',
  mocha: 'Mocha',
  jasmine: 'Jasmine',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
  puppeteer: 'Puppeteer',
  '@testing-library/react': 'React Testing Library',
  '@testing-library/vue': 'Vue Testing Library',
  supertest: 'Supertest',
  pytest: 'pytest',
  unittest: 'unittest',
  nose2: 'nose2',
  minitest: 'Minitest',
  rspec: 'RSpec',
  'go test': 'Go test',
  junit: 'JUnit',
  testng: 'TestNG',
  phpunit: 'PHPUnit',
  'pest/pest': 'Pest',
  karma: 'Karma',
  qunit: 'QUnit',
  ava: 'AVA',
  tap: 'TAP',
};

const TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.(ts|tsx|js|jsx|mjs)$/,
  /\.spec\.(ts|tsx|js|jsx|mjs)$/,
  /_test\.py$/,
  /test_.*\.py$/,
  /_spec\.rb$/,
  /test_.*\.go$/,
  /.*_test\.go$/,
  /Test\.java$/,
  /Spec\.java$/,
  /Test\.kt$/,
  /Spec\.kt$/,
];

const TEST_DIR_PATTERNS = [
  '__tests__',
  '__mocks__',
  '/test/',
  '/tests/',
  '/spec/',
  '/specs/',
];

const COVERAGE_TOOL_DEPS = [
  'c8', 'nyc', 'istanbul', '@vitest/coverage-v8', '@vitest/coverage-istanbul',
  'jest', 'coverage.py', 'simplecov',
];

const COVERAGE_DIR_NAMES = ['coverage', '.nyc_output', 'htmlcov', 'lcov-report'];

function isTestFile(file: FileTreeNode): boolean {
  if (TEST_FILE_PATTERNS.some(p => p.test(file.name))) return true;
  if (TEST_DIR_PATTERNS.some(p => file.path.includes(p))) return true;
  return false;
}

function detectFrameworks(manifests: DependencyManifest[]): string[] {
  const found = new Set<string>();
  const allDeps = manifests.flatMap(m => m.dependencies.map(d => d.name.toLowerCase()));

  for (const dep of allDeps) {
    for (const [signal, framework] of Object.entries(TEST_FRAMEWORK_DEPS)) {
      if (dep === signal.toLowerCase() || dep.includes(signal.toLowerCase())) {
        found.add(framework);
        break;
      }
    }
  }

  return [...found];
}

function detectCoverageTooling(manifests: DependencyManifest[]): boolean {
  const allDeps = manifests.flatMap(m => m.dependencies.map(d => d.name.toLowerCase()));

  for (const dep of allDeps) {
    for (const tool of COVERAGE_TOOL_DEPS) {
      if (dep === tool.toLowerCase() || dep.includes(tool.toLowerCase())) return true;
    }
  }

  // Also check scripts for coverage flags
  for (const manifest of manifests) {
    for (const script of Object.values(manifest.scripts)) {
      if (script.includes('--coverage') || script.includes('coverage')) return true;
    }
  }

  return false;
}

function detectCoverageDirectory(files: FileTreeNode[]): boolean {
  return files.some(
    f =>
      f.type === 'directory' &&
      COVERAGE_DIR_NAMES.some(d => f.name === d || f.path.endsWith('/' + d)),
  );
}

export function detectTests(
  files: FileTreeNode[],
  manifests: DependencyManifest[],
): TestInventory {
  const testFiles = files.filter(f => f.type === 'file' && isTestFile(f));
  const frameworks = detectFrameworks(manifests);

  // Fall back to file-based framework detection if no dep signals
  if (frameworks.length === 0) {
    const hasRspecFiles = files.some(f => f.name.endsWith('_spec.rb'));
    if (hasRspecFiles) frameworks.push('RSpec');

    const hasPytestIni = files.some(f => f.name === 'pytest.ini' || f.name === 'conftest.py');
    if (hasPytestIni) frameworks.push('pytest');

    const hasGoTests = files.some(f => f.name.endsWith('_test.go'));
    if (hasGoTests) frameworks.push('Go test');
  }

  return {
    testFileCount: testFiles.length,
    frameworks,
    coverageToolingPresent: detectCoverageTooling(manifests),
    coverageDirectoryPresent: detectCoverageDirectory(files),
  };
}

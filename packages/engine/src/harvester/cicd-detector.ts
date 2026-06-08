import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { CiCdInventory, DockerInventory, FileTreeNode, GithubActionsWorkflow, MakefileInventory } from '@geodesic/types';

function readFile(repoPath: string, relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoPath, relativePath), 'utf-8');
  } catch {
    return null;
  }
}

function parseGithubActionsWorkflows(
  repoPath: string,
  files: FileTreeNode[],
): GithubActionsWorkflow[] {
  const workflowFiles = files.filter(
    f =>
      f.type === 'file' &&
      f.path.includes('.github/workflows/') &&
      (f.name.endsWith('.yml') || f.name.endsWith('.yaml')),
  );

  const workflows: GithubActionsWorkflow[] = [];

  for (const file of workflowFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(content) as Record<string, unknown>;
    } catch {
      continue;
    }

    const name = typeof parsed['name'] === 'string' ? parsed['name'] : file.name.replace(/\.ya?ml$/, '');

    // Extract trigger events from the `on` key
    const onKey = parsed['on'] ?? parsed['true'];
    const triggers: string[] = [];

    if (typeof onKey === 'string') {
      triggers.push(onKey);
    } else if (Array.isArray(onKey)) {
      triggers.push(...(onKey as string[]).filter(t => typeof t === 'string'));
    } else if (typeof onKey === 'object' && onKey !== null) {
      triggers.push(...Object.keys(onKey));
    }

    // Extract job names
    const jobsObj = parsed['jobs'] as Record<string, unknown> | undefined;
    const jobs = jobsObj ? Object.keys(jobsObj) : [];

    workflows.push({ name, file: file.path, triggers, jobs });
  }

  return workflows;
}

function detectDockerfile(repoPath: string, files: FileTreeNode[]): DockerInventory {
  const dockerfiles = files.filter(
    f => f.type === 'file' && (f.name === 'Dockerfile' || f.name.startsWith('Dockerfile.')),
  );
  const hasDockerfile = dockerfiles.length > 0;

  const hasCompose = files.some(
    f =>
      f.type === 'file' &&
      (f.name === 'docker-compose.yml' ||
        f.name === 'docker-compose.yaml' ||
        f.name.startsWith('docker-compose.')),
  );

  const exposedPorts: number[] = [];

  for (const file of dockerfiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    const portPattern = /^EXPOSE\s+(\d+)/gm;
    let match: RegExpExecArray | null;
    while ((match = portPattern.exec(content)) !== null) {
      const port = parseInt(match[1] ?? '0', 10);
      if (port > 0 && !exposedPorts.includes(port)) exposedPorts.push(port);
    }
  }

  // Also check compose files for ports
  const composeFiles = files.filter(
    f =>
      f.type === 'file' &&
      (f.name.startsWith('docker-compose') || f.path.includes('/compose/')),
  );
  for (const file of composeFiles) {
    const content = readFile(repoPath, file.path);
    if (!content) continue;

    const portPattern = /["']?(\d+):(\d+)["']?/g;
    let match: RegExpExecArray | null;
    while ((match = portPattern.exec(content)) !== null) {
      const hostPort = parseInt(match[1] ?? '0', 10);
      if (hostPort > 0 && !exposedPorts.includes(hostPort)) exposedPorts.push(hostPort);
    }
  }

  return { hasDockerfile, hasCompose, exposedPorts: exposedPorts.sort((a, b) => a - b) };
}

function detectKubernetes(files: FileTreeNode[]): boolean {
  return files.some(
    f =>
      f.type === 'file' &&
      (f.path.includes('k8s/') ||
        f.path.includes('kubernetes/') ||
        f.path.includes('manifests/') ||
        (f.name.endsWith('.yaml') &&
          (f.name.includes('deployment') || f.name.includes('service') || f.name.includes('ingress')))),
  );
}

function detectHelm(files: FileTreeNode[]): boolean {
  return files.some(
    f =>
      f.type === 'file' &&
      (f.path.includes('helm/') || f.name === 'Chart.yaml' || f.name === 'values.yaml'),
  );
}

function parseMakefile(repoPath: string, files: FileTreeNode[]): MakefileInventory {
  const makefileNode = files.find(f => f.type === 'file' && f.name === 'Makefile');
  if (!makefileNode) return { present: false, targets: [] };

  const content = readFile(repoPath, makefileNode.path);
  if (!content) return { present: true, targets: [] };

  // Match make targets: lines starting with a word followed by a colon (not tab-indented)
  const targetPattern = /^([a-zA-Z0-9_-]+)\s*:/gm;
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = targetPattern.exec(content)) !== null) {
    const target = match[1];
    if (target && !target.startsWith('.') && !targets.includes(target)) {
      targets.push(target);
    }
  }

  return { present: true, targets };
}

function inferDeploymentTargets(
  files: FileTreeNode[],
  github: GithubActionsWorkflow[],
  hasKubernetes: boolean,
  hasHelm: boolean,
  docker: DockerInventory,
): string[] {
  const targets = new Set<string>();

  if (hasKubernetes) targets.add('Kubernetes');
  if (hasHelm) targets.add('Helm');
  if (docker.hasDockerfile) targets.add('Docker');

  // Infer from GH Actions workflow names and job content
  for (const wf of github) {
    const lower = wf.name.toLowerCase();
    if (lower.includes('deploy') || lower.includes('release') || lower.includes('publish')) {
      if (lower.includes('aws') || wf.jobs.some(j => j.includes('aws'))) targets.add('AWS');
      if (lower.includes('gke') || lower.includes('gcp') || wf.jobs.some(j => j.includes('gke'))) targets.add('GCP');
      if (lower.includes('azure') || wf.jobs.some(j => j.includes('azure'))) targets.add('Azure');
      if (lower.includes('fly') || wf.jobs.some(j => j.includes('fly'))) targets.add('Fly.io');
      if (lower.includes('railway') || wf.jobs.some(j => j.includes('railway'))) targets.add('Railway');
      if (lower.includes('vercel') || wf.jobs.some(j => j.includes('vercel'))) targets.add('Vercel');
      if (lower.includes('netlify') || wf.jobs.some(j => j.includes('netlify'))) targets.add('Netlify');
      if (lower.includes('heroku') || wf.jobs.some(j => j.includes('heroku'))) targets.add('Heroku');
    }
  }

  // Check for platform-specific config files
  if (files.some(f => f.name === 'fly.toml')) targets.add('Fly.io');
  if (files.some(f => f.name === 'railway.json' || f.name === 'railway.toml')) targets.add('Railway');
  if (files.some(f => f.name === 'vercel.json')) targets.add('Vercel');
  if (files.some(f => f.name === 'netlify.toml')) targets.add('Netlify');
  if (files.some(f => f.name === 'Procfile')) targets.add('Heroku');
  if (files.some(f => f.name === 'app.yaml' && f.path.includes('appengine'))) targets.add('GCP App Engine');
  if (files.some(f => f.name === '.elasticbeanstalk' || f.name === 'Dockerrun.aws.json')) targets.add('AWS Elastic Beanstalk');

  return [...targets];
}

export function detectCiCd(repoPath: string, files: FileTreeNode[]): CiCdInventory {
  const githubActions = parseGithubActionsWorkflows(repoPath, files);
  const docker = detectDockerfile(repoPath, files);
  const kubernetes = detectKubernetes(files);
  const helm = detectHelm(files);
  const makefile = parseMakefile(repoPath, files);
  const deploymentTargets = inferDeploymentTargets(files, githubActions, kubernetes, helm, docker);

  return {
    githubActions,
    docker,
    kubernetes,
    helm,
    makefile,
    deploymentTargets,
  };
}

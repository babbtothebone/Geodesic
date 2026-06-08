# Contributing to Geodesic

Thank you for your interest in Geodesic. This document covers everything you need to get from zero to a passing CI run locally.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 22 LTS or later |
| npm | 10 or later (ships with Node 22) |
| Git | Any recent version |

An AI provider API key (Anthropic, OpenAI, Gemini, Azure OpenAI, or a running Ollama instance) is required to run end-to-end analysis. It is **not** required to run tests or work on the harvester, PII intercept, or artifact layers.

---

## Setup

```bash
git clone https://github.com/direwulfco/geodesic.git
cd geodesic
npm install
npm run build
```

`npm install` bootstraps all workspaces in a single pass. `npm run build` compiles `@geodesic/types` → `@geodesic/engine` → `@geodesic/cli` in dependency order.

---

## Monorepo Structure

```
packages/
├── types/       # Shared TypeScript types — build this first
├── engine/      # Core analysis daemon — REST API on localhost
├── cli/         # Thin CLI wrapper (`geodesic analyze`)
└── vscode-ext/  # VS Code/Cursor extension (.vsix)
specs/           # Spec files — read the relevant spec before touching a component
```

All analysis logic lives in `packages/engine`. The extension and CLI are thin shells that call the engine's local REST API.

---

## Running the Engine Locally

```bash
npm run build
node packages/engine/dist/server/start.js
```

The engine starts on `http://localhost` (port configured in `.geodesic/config.json`). Point the CLI or extension at it from there.

---

## Running Tests

```bash
npm test
```

Uses [Vitest](https://vitest.dev/). To run in watch mode during development:

```bash
npx vitest
```

---

## Lint and Type Check

```bash
npm run lint        # ESLint across all packages
npm run typecheck   # tsc --build with strict mode — zero `any` allowed
```

Both checks run in CI on every push and PR. A failing typecheck blocks merge.

---

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<slug>` | `feat/azure-provider` |
| Bug fix | `fix/<slug>` | `fix/pii-regex-false-positive` |
| Docs | `docs/<slug>` | `docs/provider-setup` |
| Chore | `chore/<slug>` | `chore/upgrade-vitest` |

Branch off `main`. Open your PR back to `main`.

---

## Opening a Pull Request

1. Make sure `npm run lint`, `npm run typecheck`, and `npm test` all pass locally.
2. Keep PRs focused — one logical change per PR.
3. Write a clear description: what changed and why.
4. If your change touches the PII/HIPAA intercept layer or the attestation chain, call that out explicitly in the PR description.
5. If your change adds a new AI provider or modifies the Crystal format, update the relevant spec in `specs/`.

---

## Good First Issues

Issues tagged [`good first issue`](https://github.com/direwulfco/geodesic/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) are scoped to be self-contained and don't require deep knowledge of the full pipeline. A good place to start.

---

## Questions

Open a [GitHub Discussion](https://github.com/direwulfco/geodesic/discussions) for anything that isn't a bug or feature request.

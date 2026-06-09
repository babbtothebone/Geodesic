# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-06-09

### Fixed
- **LM bridge concurrency**: parallel `bridge.complete()` calls (arch-map + skill-file + gap-report integration phase) no longer fail on transient socket resets. The engine-side client now retries `ECONNRESET` / `socket hang up` / undici `UND_ERR_SOCKET` up to two times with exponential backoff (50 ms / 150 ms / 350 ms). Structured 4xx/5xx responses from the bridge are never retried.
- **Copilot provider error mapping**: `mapError()` no longer instructs users to "reload the VS Code window" on every opaque `fetch failed`. Only true `ECONNREFUSED` (bridge actually gone) suggests reload; transient transport errors after retries surface a neutral "bridge may be overloaded" message. `AbortError` now maps to a distinct timeout message.
- **LM bridge lockfile path**: resolved against the current `os.homedir()` on every call instead of cached at module load. Prevents stale-path writes when `$HOME` is mutated after import (debug-attach flows, shell re-init, sandboxed test environments).
- **Docs ingest `_unreachable.md` parser**: `collectIngestedDocs()` now parses YAML-list `_unreachable.md` entries into `knownGaps`, merging with `_index.json` (index entries win on title collision). Closes the gap between scaffolded template and runtime behavior.

### Changed
- **VS Code extension repackaged as `geodesic-topo-2.0.0.vsix`**; install instruction in `README.md` updated accordingly.
- All workspace package versions (`@geodesic/types`, `@geodesic/engine`, `@geodesic/cli`, `@geodesic/vscode-ext`) and the `GEODESIC_VERSION` constant bumped to `2.0.0` together: single source of truth in `packages/engine/src/version.ts`.

### Internal
- ESLint config gained a test-file override (`**/__tests__/**`, `**/*.test.ts`) relaxing `no-non-null-assertion`, `no-unsafe-*`, `no-confusing-void-expression`, `require-await`, `unbound-method`: patterns that are idiomatic in test code. Production rules stay strict.
- VS Code extension typecheck cleanup: dropped invalid `(this as { _token })` cast (replaced with mutable `_token`); typed `catch` callback parameters as `unknown`; replaced top-level `await import()` in the bridge-server test with hoisted static import.
- Removed unused type imports (`OpsSnapshotsBundle`, `HarvestedSchema`) from `packages/engine/src/synthesis/prompt-builder.ts`. Fixed useless `\[` escape in Prisma field regex. Replaced redundant `| string` in `OpsSnapshotEnvironment` union with branded `(string & {})` to keep autocomplete on the canonical literals. Replaced invalid `void | Promise | Thenable` union in preflight `actions[].run` signature with `Promise<void> | Thenable<unknown> | undefined`.

## [1.1.0] - 2026-05-04

### Added
- Hierarchical phase-tree progress UI replacing the flat activity log. Seven explicit phases (Harvest, Scrub, Crystal Query, Discovery, Deep Dives, Artifacts, Crystal Extraction) are visible from the moment a scan starts.
- Concurrent deep-dive subsystems render as parallel `⟳` glyphs with per-phase durations on completion.
- Optimistic running state on click-to-scan so the button feels zero-latency.
- Engine stderr mirrored to `~/.geodesic/engine-stderr.log`; crash toasts now surface real V8 fatal/exception lines instead of opaque exit codes.
- Friendly provider error messages: billing/quota errors mapped to `INSUFFICIENT_CREDITS` with provider-specific billing URLs (Anthropic, OpenAI, Gemini, Azure); auth/rate-limit/network failures all get prefixed user-actionable guidance.
- Completion banner across the results panel header, plus duration in the completion toast.

### Changed
- Intercept layer now scrubs harvest data in place — no stringify→parse roundtrip and no parallel tree clone. Returns `scrubbedHarvest` directly for memory efficiency on large repos.
- Subsystem prompt slicing capped at 200 source files with full detail (hubs and entry points pinned); overflow listed as path-only inventory to keep token budgets predictable.
- Engine subprocess given `--max-old-space-size=8192` headroom for medplum-scale repositories.
- Synthesis warnings no longer pollute `geodesic-error.log` — warnings stay in the activity feed; the error log is fatal-only.

### Fixed
- Results panel: CSS class collision that was hiding tab bodies.
- Results panel: replaced inline `onclick` attributes with `data-attribute` + delegated listener pattern (CSP-compliant). Tabs, filters, finding rows, and artifact links now work correctly.

### Removed
- Legacy `anthropic-beta: prompt-caching-1` header — Anthropic now rejects this header (caching is GA via `cache_control`).

## [1.0.0] - 2026-05-01

### Added
- Initial public release of Geodesic.
- Static Harvester: deep static analysis across files, routes, databases, auth, dependencies, tests, and infrastructure.
- PII/HIPAA Intercept Layer: scrubs every string value before any external AI call, replaces detections with typed reversible tokens, writes a tamper-evident attestation chain.
- Crystal Store: shared learning system over a team GitHub repo. Pulls matching prior analyses to reduce token cost; pushes new structural patterns after each successful run.
- AI Synthesis Engine: provider-agnostic adapter for Anthropic Claude, OpenAI GPT, Google Gemini, Azure OpenAI, and Ollama (local).
- Artifact Generator: produces three outputs per scan — `architecture-map.md`, `skill-file.geodesic.json` + `skill-file.geodesic.md`, and `gap-report.md`.
- VS Code / Cursor / Antigravity / VSCodium extension (`.vsix`) with bundled engine — no separate install required.
- JetBrains plugin (IntelliJ, WebStorm, PyCharm, GoLand, Rider).
- CLI wrapper: `geodesic analyze`.
- MIT license.

[Unreleased]: https://github.com/direwulfco/geodesic/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/direwulfco/geodesic/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/direwulfco/geodesic/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/direwulfco/geodesic/releases/tag/v1.0.0

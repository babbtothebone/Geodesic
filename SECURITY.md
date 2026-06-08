# Security Policy

Geodesic ships PHI/HIPAA handling as a core feature, so security reports are taken seriously and triaged on a tight clock.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.**

Use one of these private channels:

1. **Preferred — GitHub Security Advisories**
   https://github.com/direwulfco/geodesic/security/advisories/new
   This creates a private advisory thread, lets us coordinate a fix, and supports CVE issuance.

2. **Email** — `info@direwulf.com`
   Use this if GitHub Security Advisories is unavailable to you. Include the same information listed below.

Please include:

- A clear description of the vulnerability
- Steps to reproduce (or a proof-of-concept)
- Affected version(s)
- Impact assessment from your perspective
- Any suggested mitigation, if you have one

## PHI/HIPAA-Specific Issues — Critical Priority

Reports involving Geodesic's intercept layer, attestation chain, or any code path that could cause **PHI or PII to escape scrubbing** are treated as **Critical** by default and bypass normal triage queues.

Examples that fall under this category:
- A scrub bypass that allows a real PHI value to reach the AI provider
- A confidence-threshold gap that lets an uncertain detection through unscrubbed
- An attestation chain that can be tampered with, truncated, or replayed
- A Crystal containing repo data, file contents, or identifying values
- A logging or telemetry path that captures unscrubbed harvest data

If your report touches any of these, say so explicitly in the title — it routes the report to a faster review path.

## Response Targets

| Severity | Acknowledgment | Initial Assessment | Fix Target           |
| -------- | -------------- | ------------------ | -------------------- |
| Critical | < 24 hours     | < 72 hours         | Coordinated disclosure timeline (typically < 14 days) |
| High     | < 48 hours     | < 5 business days  | < 30 days            |
| Medium   | < 5 days       | < 10 business days | Next minor release   |
| Low      | < 10 days      | Next triage cycle  | Future release       |

Times are best-effort and assume the report includes enough information to act on. We may ask follow-up questions before the assessment clock starts.

## Disclosure Policy

We follow **coordinated disclosure**. After a fix ships:

- Reporters are credited in the release notes (unless they request anonymity)
- A security advisory is published with details, affected versions, and mitigation
- A CVE is requested for any vulnerability with measurable impact

Please give us a reasonable window to ship a fix before public disclosure. We will not pressure you to delay disclosure indefinitely, and we will keep you informed of our progress.

## Out of Scope

The following are **not** considered security vulnerabilities for this project:

- Issues in third-party AI provider APIs (report to the provider directly)
- Configuration mistakes by end users (e.g. committing `.geodesic/config.json` with API keys)
- Crystal Store sync failures that are network-related rather than tampering-related
- Theoretical attacks that require pre-existing local code execution on the user's machine

If you are unsure whether something is in scope, send it anyway — we would rather receive an out-of-scope report than miss a real one.

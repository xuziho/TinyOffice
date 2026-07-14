<p align="center">
  <img src="docs/assets/brand/tinyoffice-lockup-on-paper.svg" width="220" alt="TinyOffice — cyan TO boss mark wearing sunglasses and smiling" />
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# TinyOffice

TinyOffice is an early-stage, self-hosted company-operations foundation for persistent AI employees and the people who work with them. It combines a Slack/Discord-like collaboration workspace with runtime sessions, background work, operational evidence, and a small governance layer.

<!-- Creator note reserved for the project author before the public launch announcement. -->

> TinyOffice is an early public Alpha intended for a single Owner. Passkey authentication is built in; internet-facing deployments still require HTTPS, backups, host patching, and network hardening.

## What is in the repository

- `apps/tinyoffice-web-shadcn/` — the standalone shadcn/ui frontend
- `src/` — runtime, collaboration, governance, API, and storage code
- `packages/` — reusable runtime packages
- `scripts/` — local runtime, verification, backup, and documentation tools
- `tests/` — runtime and contract tests
- `docs/` — the product manual and source of truth for intended behavior

Local company records, employee workspaces, uploaded assets, secrets, runtime databases, screenshots, and QA captures are deliberately excluded from the public source boundary.

## Requirements

- Node.js 22.19 or newer
- npm
- Docker, for the PostgreSQL-backed local runtime
- PowerShell 7 is recommended on Windows for the supplied runtime scripts

## Local development

```powershell
npm run setup
npm run runtime:postgres:ensure
npm run runtime:postgres:init-schema
npm start
```

The setup command installs both the root runtime dependencies and the standalone shadcn frontend dependencies. Confirm `node --version` reports Node.js 22.19 or newer before setup; unsupported Node versions may allow installation with warnings but are not a valid TinyOffice runtime.

TinyOffice serves the web app on `http://localhost:5175` and the runtime API on `http://127.0.0.1:8095`. On a clean database, startup prints a one-time URL for creating the Owner passkey. The browser then continues into Company onboarding; the repository does not ship a hidden user or default Company. See [Owner authentication](docs/product/owner-authentication.md) and the [first-user onboarding acceptance runbook](docs/developer/runbooks/first-user-onboarding.md).

Useful checks:

```powershell
npm run check
npm test
npm run docs:build
npm run check:open-source
```

See the [developer runbook](docs/developer/runbook.md) for the complete local verification path.

## Configuration and data boundaries

Copy `.env.example` only as a reference for optional environment overrides. Do not commit real provider keys or company data. TinyOffice runtime data belongs in PostgreSQL and ignored local runtime directories, not in source control.

## Project status and documentation

The Markdown product manual in `docs/` records product intent, current scope, architecture decisions, implementation mapping, and verification. Start with [the product manual](docs/index.md) and [the feature map](docs/product/feature-map.md).

This repository is the canonical public TinyOffice repository. The completed transition from private incubation is recorded in [Open-source distribution](docs/product/open-source-distribution.md).

## Contributing and security

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Report suspected vulnerabilities using the private process in [SECURITY.md](SECURITY.md), not a public issue.

## License

TinyOffice is licensed under the [Apache License 2.0](LICENSE). Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

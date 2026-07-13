# Contributing to TinyOffice

TinyOffice is preparing for its first public source release. Contributions are welcome after the public repository and project license are announced.

## Before opening a change

1. Search existing issues and the product manual in `docs/`.
2. Open an issue for behavioral, architectural, data-model, dependency, or broad UI changes.
3. Keep product intent and implementation aligned. If they disagree, describe the mismatch explicitly.
4. Never include company data, employee workspaces, provider credentials, runtime databases, uploaded files, or local QA captures.

## Development baseline

Use Node.js 22.19 or newer and install dependencies with `npm ci`. The active frontend is `apps/tinyoffice-web-shadcn`; new base UI primitives must come from shadcn/ui rather than retired local UI systems.

Before requesting review, run the checks appropriate to the changed surface. The normal full gate is:

```powershell
npm run check
npm test
npm run docs:build
npm run check:open-source
```

Changes that touch runtime APIs, PostgreSQL, dependencies, backup/restore, or local service startup also need the full preview-stack verification described in `docs/developer/runbook.md`.

## Pull requests

- Explain the user-visible outcome and the product rule being changed.
- Link the issue when one exists.
- Include focused tests and documentation for durable behavior changes.
- Report exact verification commands and results.
- Keep migrations and contract removals explicit; do not add silent compatibility fallbacks.

By contributing, you agree that your contribution will be licensed under the project license selected before the public launch. The repository will not accept external contributions until that license is present.

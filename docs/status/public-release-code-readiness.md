# Public release code readiness

Audit date: 2026-07-13. Updated after canonical public repository creation and clean-install acceptance.

## Result

TinyOffice has a coherent modular-monolith foundation and does not need an architectural rewrite before its first public release. The release gate is documentation accuracy, reproducible setup, license clarity, repository hygiene, and focused separation of mixed responsibilities.

## Completed in this pass

- selected Apache-2.0 as the TinyOffice project license;
- reconciled the source architecture map with the implemented shadcn routes;
- added a contributor-facing source entry map;
- verified package-lock license metadata against installed package metadata;
- separated PI attachment/diagnostic I/O from provider orchestration while preserving the public provider exports;
- retained the clean snapshot and secret-pattern release gate established during private incubation.

## Dependency license audit

The installed root dependency tree contains MIT, Apache-2.0, BSD-3-Clause, ISC, BlueOak-1.0.0, and 0BSD packages. Six lockfile entries omitted a license field, but their installed package metadata resolves to MIT or BlueOak-1.0.0. No GPL-family or unknown installed license was found in this audit.

This is an engineering inventory, not legal advice. Dependency changes must rerun the audit before a release.

## Accepted debt for the first public release

These concentrations are real maintenance debt but are not release blockers while their tests and ownership remain clear:

- `src/runtime/realtime/tinyoffice-server.ts` still combines runtime service composition and HTTP lifecycle wiring;
- `src/api/contracts/tinyoffice-frontend-api-contracts.ts` is a large public contract barrel spanning multiple domains;
- `src/work/tasks-view-model.ts` and `src/work/work-service.ts` contain broad Work projection and lifecycle behavior;
- several frontend route components and integration test files are large.

Follow-up splits should be issue-driven and preserve a stable import surface. The preview server should first separate service composition from HTTP lifecycle. Frontend contracts should split by domain behind the existing package export. Tests should split when a touched domain can move with no fixture duplication.

## Rejected cleanup

- no microservice split;
- no mass renaming of fixtures;
- no mechanical file splitting by line count;
- no deletion of legitimate fallback behavior or negative legacy-contract tests;
- no parallel private/public product implementations.

## Repository-creation gate result

Passed. The verified snapshot became the canonical public repository at `https://github.com/xuziho/TinyOffice`; the private incubation repository is archived and remains private.

The first public Alpha clean-install pass then cloned that canonical repository into a new directory, installed under supported Node.js, initialized an isolated PostgreSQL database, completed first-user Company creation, verified the owner and HR identities, and verified current-Company persistence after restart. That pass found and closed one installation gap: root `npm ci` did not install the standalone frontend dependencies. The canonical `npm run setup` command now installs both dependency trees.

## Public Alpha boundary

The first public Alpha is an evaluation release for a single Owner. It includes passkey authentication plus the current collaboration, runtime, Work, configuration, and evidence surfaces. Internet-facing operation still requires ordinary deployment hardening such as HTTPS, host patching, backup protection, and network policy; the tag and release notes must not imply that TinyOffice supplies those host-operations guarantees.

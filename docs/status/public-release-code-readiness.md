# Public release code readiness

Audit date: 2026-07-13.

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

- `src/runtime/realtime/tinyoffice-chat-preview-server.ts` combines development-preview composition and lifecycle wiring;
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

## Final repository-creation gate

Run the full checks, build an exported snapshot, run `npm ci` and the checks from that extracted snapshot, scan it for secrets, then create the new public repository from one clean initial commit. The private incubation repository remains private until the public clone is verified.

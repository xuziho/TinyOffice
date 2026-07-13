# Product Manual Blueprint

This page defines how the TinyOffice product manual stays useful for future development. The manual is product memory, not a scratchpad and not a compatibility archive.

## Purpose

The product manual must answer three questions:

1. What are we building?
2. What is already implemented and verified?
3. Where should the next code change connect?

The manual should contain stable product decisions, implementation boundaries, API contracts, runbooks, and verification commands. Temporary investigation notes, one-off audits, migration logs, and superseded plans should not live in the product manual.

## Current Documentation Shape

`docs/product/` records product intent, scope, user-visible behavior, and accepted product-model decisions.

`docs/technical/` records implementation boundaries, data flow, API contracts, runtime behavior, and focused verification commands.

`docs/developer/` records local development workflow, preview steps, runbooks, and maintenance rules.

`docs/status/` records current factual alignment between product, code, and runtime state. These pages must say when a surface is not rebuilt yet.

`docs/archive/` may hold historical material when explicitly needed, but archived material is not product truth.

## Frontend Boundary

The current documented frontend target is `apps/tinyoffice-web-shadcn`.

New frontend documentation must describe the shadcn rebuild only. Do not point implementation work at retired local primitives, old page shells, old CSS classes, or old frontend module paths. If a capability has not been rebuilt in shadcn yet, say that directly instead of pretending the old surface still applies.

## Product Truth Rules

- Prefer hard current facts over transition wording.
- Do not preserve legacy behavior as a reference, fallback, compatibility path, or source of truth.
- If code and docs disagree, record the disagreement and recommend whether code, docs, or both should change.
- If a future UI surface is not implemented, label it as not rebuilt yet.
- Do not add fake data, fake API capability, or synthetic frontend state to make a product page look complete.

## Technical Page Template

A technical page should cover:

1. Module boundary.
2. Data source or request path.
3. API or view-model contract.
4. Runtime events or state transitions when relevant.
5. Verification command.
6. Known gaps, only when they are current and actionable.

## Product Page Template

A product page should cover:

1. One-sentence definition.
2. User-facing purpose.
3. Entry points.
4. Core concepts.
5. Supported capability.
6. Explicit non-goals or boundaries.
7. Links to technical implementation pages.

## Maintenance Rules

- Keep docs concise and current.
- Remove obsolete rules instead of keeping them with warnings.
- Do not turn docs into a changelog of abandoned approaches.
- Update docs when product understanding changes.
- Run `npm run docs:build` after broad documentation edits.

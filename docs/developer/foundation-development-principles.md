# TinyOffice Foundation Development Principles

This page records the foundation-level development principles for TinyOffice. It is a developer-facing rule page, not a product feature page.

Use it before adding or restructuring core product infrastructure such as Chat, realtime, runtime dispatch, identity, permissions, storage, Sessions, Tasks, Context, attachments, or frontend shell behavior.

## Mature Reference First

TinyOffice should not invent mature product patterns from scratch when a strong reference already exists.

Default order:

1. Use a mature framework, protocol, or product pattern directly when it fits TinyOffice.
2. Reuse or closely mirror a mature local implementation when the product shape is the same.
3. Adapt the mature reference into TinyOffice-owned product language.
4. Combine references only when one source cannot satisfy the core constraint.
5. Write a custom implementation last, and record why mature references did not fit.

This applies to:

- chat and collaboration product models
- frontend component primitives and interaction patterns
- agent/runtime event streams
- tool and permission boundaries
- storage and realtime infrastructure
- session and trace inspection UX

Reference products are not product truth. They are evidence for mature behavior. TinyOffice product truth still lives in `docs/` and current code.

## Product Model Before UI

Do not create a UI box first and then invent a product object to fill it.

Every user-visible object should map to one of:

- an existing TinyOffice product model
- an existing backend capability being productized
- a retired behavior being rebuilt as a TinyOffice-owned model
- a clearly marked future capability that is not yet implemented

If no real product model exists, the UI should say less instead of pretending the object is complete.

## Backend Capability First

TinyOffice already has meaningful backend/runtime capability from the earlier system. New frontend work should start by checking the backend truth:

- tables and repositories
- service boundaries
- API contracts
- runtime dispatch behavior
- session/process/work evidence
- tests and smoke scripts

The frontend should productize backend capability instead of creating standalone fake state.

When backend capability is missing or shaped around the old carrier, rebuild it through TinyOffice-owned APIs and product models. Do not preserve the old interface shape just because it once worked.

## Hard Cut By Slice

TinyOffice is in migration and rebuild mode. Compatibility residue is technical debt unless a decision record explicitly accepts it with a retirement condition.

For each product slice:

1. Define the TinyOffice-owned product model and API boundary.
2. Move the product caller to the new boundary.
3. Remove stale product paths in the same slice when practical.
4. If old data must remain as evidence, label it as legacy/internal evidence.
5. Do not keep dual product paths for convenience.

This does not require rewriting the whole repository at once. It does require each completed slice to leave a clean boundary.

## Hard Migration And Deletion Default

Migrations, deletions, and contract changes are hard cuts by default.

Use this rule when changing database shape, API contracts, product models, frontend routes, identity fields, runtime configuration, provider boundaries, or old carrier residue:

1. Move the source of truth to the new model.
2. Delete old product entry points in the same slice when practical.
3. Remove deprecated fields, aliases, UI routes, API routes, tests, docs, and scripts that still make the old path look valid.
4. Make missing required context fail with an explicit error or setup gate.
5. Classify every remaining old-name hit as archive, current-slice implementation debt, report-only check, or retired-route negative test fixture. During pre-release, do not keep historical migration guards only to preserve local test data.

Do not keep hidden fallback, dual-read/write, compatibility aliases, default-company guesses, old adapter surfaces, deprecated product fields, or "just in case" bridge code unless the user explicitly accepts a time-boxed exception.

An accepted exception must have:

- a GitHub Issue
- a visible status label or docs note
- an owner
- the reason the hard cut cannot happen immediately
- deletion criteria and verification steps

Before a production data-compatibility commitment exists, TinyOffice uses a pre-release database baseline. Do not keep historical A-to-B schema migration scripts only to preserve local test data. If local PostgreSQL data conflicts with the current baseline, reset the test database. Future production migrations may be introduced only when real user data must be preserved, and they still must not become product compatibility behavior.

## No Hidden Fallback

Missing product context is an error, not permission to guess.

Do not introduce hidden fallback for:

- company id
- member identity
- employee identity
- runtime-capable employee selection
- channel/topic membership
- provider selection
- legacy file or database state

Development preview may use explicit parameters, but product runtime must not silently choose a default company, first employee, old global store, or legacy alias.

## Provider Adapter Boundary

Chat, Work, Sessions, Access, and Settings must not bind directly to one runtime provider.

Provider-specific logic belongs behind runtime adapter boundaries. Product code should depend on provider-neutral concepts:

- reply request
- stream/status event
- tool call evidence
- usage
- session id
- process trace id
- final message or result

Pi is the current provider path. Future Codex/OpenCode/Claude Code-style providers should not require rewriting product features.

## Mattermost Boundary

Retired carrier systems are not TinyOffice product shells, compatibility targets, fallback UI, or debug UI.

Allowed current references:

- retired old-system material
- archived docs
- migration notes
- negative tests or guardrails
- legacy/internal evidence fields that still exist in persisted history

Not allowed in new product paths:

- Mattermost-native Team/User/Channel/Post ids as public product identity
- plugin proxy routes as product APIs
- Mattermost UI entry points as product entry points
- carrier-native events as realtime contracts
- old interface shapes preserved just to avoid rebuilding the model

## Documentation Separation

Use docs layers consistently:

| Layer | Directory | Purpose |
| --- | --- | --- |
| Product facts | `docs/product/` | What the product object is, who uses it, where it appears, and what boundaries it has. |
| Technical contracts | `docs/technical/` | API, data, runtime, event, and test contracts. |
| Developer rules/runbooks | `docs/developer/` | How agents and engineers should make changes, verify work, and avoid debt. |
| Current status | `docs/status/` | What is implemented, what is incomplete, and where docs/code still disagree. |

Do not put long-lived development rules into product feature pages. Do not put temporary status as if it were permanent product truth.

## Architecture Placement Rule

New capabilities should fit the current modular monolith skeleton:

```text
Frontend UI
  -> TinyOffice API
  -> Chat / Message / Work / Runtime / Governance module
  -> Runtime Dispatch / Provider Adapter when execution is needed
  -> Realtime when user-visible state changes
  -> PostgreSQL unified fact database
```

If a new feature cannot be placed clearly in this skeleton, stop and clarify the product model before writing code.

## Verification Standard

Foundation changes need evidence appropriate to risk:

- docs-only changes: `npm run docs:build`
- API or runtime contract changes: targeted tests plus `npm run check`
- Chat/realtime/runtime changes: targeted tests plus a real preview smoke when the stack is available
- deletion/retirement: keyword residue scan with each remaining hit classified

Passing tests are not enough when the change is about product model or migration boundary. The docs, code, and user-visible behavior must agree.

# Development Workflow

This page defines the current TinyOffice development workflow. TinyOffice uses a direct single-thread development model: the current agent thread implements the work it accepts.

## Product Manual First

`docs/` is the product manual and shared product memory. If product intent changes, update the relevant Markdown page. Do not treat chat history or deleted legacy plans as current product truth.

## Work Binding

Formal development that changes code, tests, database behavior, runtime behavior, permissions, deployment, or architecture should bind to a GitHub Issue before implementation unless the user explicitly asks for a local-only patch.

Small docs-only clarifications can stay in the main checkout when they do not alter code, scripts, dependencies, deployment, runtime behavior, or broad workflow policy.

Migrations, deletions, and contract changes are hard cuts by default. Do not retain hidden fallback, compatibility aliases, dual product paths, deprecated fields, default-company guesses, or old adapter surfaces unless the user explicitly accepts a time-boxed exception with an Issue, owner, visible label, and deletion criteria.

## Rule-Level Fixes

Do not fix product bugs by adding local exception checks around a broken state, such as preserving the wrong role and adding a side condition that happens to allow one actor through. Repair the underlying product rule, permission resolver, data model, or projection contract so every caller and UI surface receives the same final truth.

When answering behavior questions, do not give vague or hedged claims if the repository can answer them. Inspect the relevant source, tests, runtime data, or docs first, then state the exact current behavior and cite the code path. If the fact still cannot be determined from available evidence, say exactly what is unknown and what evidence is missing.

## Task Tiers

Before mutating TinyOffice state, classify the work and state the classification to the user.

| Tier | Use For | Default Path |
| --- | --- | --- |
| `lightweight` | Read-only investigation, current-state checks, docs-only wording, comments, or other non-behavioral cleanup. | Answer or edit directly when no formal development state changes are needed. |
| `standard` | Ordinary code, UI behavior, API, tests, or docs+code changes. | Use `main` only for tiny low-risk patches on a clean checkout; otherwise create or switch to a `codex/...` branch and implement directly in the current thread. |
| `heavy` | Database, runtime, auth, permissions, identity, messaging foundation, deployment, architecture, deletion, or retirement work. | Discuss the product/technical tradeoff when needed, then implement directly in a scoped branch after the direction is accepted. |

If multiple tiers match, use the lowest valid tier by default so routine work stays fast. Do not down-tier durable database changes, auth/permissions/identity, deployment, deletion/retirement, or broad architecture decisions. If uncertain, choose `standard`.

## Direct Execution

The current thread owns the implementation from start to finish.

Tiny, low-risk code or docs patches may stay on `main` when all of these are true:

- the checkout is clean before editing
- the diff is small and easy to review
- the change does not touch database, auth, permissions, identity, deployment, architecture, dependencies, runtime foundations, deletion/retirement, or broad workflow rules
- relevant checks can run immediately

For ordinary or risky code, tests, runtime, database, deployment, architecture, deletion, retirement, or broad workflow-rule changes:

1. Confirm the task tier.
2. Bind to a GitHub Issue when the work is formal development.
3. Create or switch to a `codex/...` branch before editing behavior files.
4. Inspect the relevant docs and source.
5. Implement the smallest coherent change.
6. Run checks appropriate to the changed surface.
7. Review the diff before finishing.
8. Commit, push, and open or update a PR when the change is meant to enter `main` through a branch.
9. After merge and acceptance, return the checkout to a clean updated `main` when safe.

Do not make non-trivial behavior changes directly on `main`. If branch work cannot safely return to `main`, report the exact blocker instead of leaving the state implicit.

## Review And Closeout

Closeout must include content review:

- read docs changes
- inspect code diffs
- verify UI/runtime evidence when relevant
- run appropriate checks
- clean up stale local state

## Verification

Default checks:

```powershell
npm run check
npm test
npm run docs:build
```

Product smoke:

```powershell
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
npm start
```

Use the real Chat preview when the question is whether the current local product path works against PostgreSQL-backed runtime data.

## Runtime Smoke Lock

No-carrier Chat smoke and standalone frontend browser smoke do not need a runtime lock.

Use `.runtime/smoke.lock.json` only when a task will occupy shared local runtime resources such as `8095`, PostgreSQL-backed preview state, runtime worker/session state, or the user's currently open local preview.

```powershell
npm run smoke:lock:acquire -- "PR #N real runtime smoke"
npm run smoke:lock:release -- <token>
```

If a lock is held, do not silently wait or steal it. Report the holder, resource, and completed verification level.

## Local Evidence Rule

If the user reports a local `127.0.0.1` / `localhost` page, verify the same local environment first. Remote dogfood or mini-host success does not prove the user's local page is fixed.

For user-visible Chat/runtime changes, record:

- exact URL
- member identity used
- room or entry used
- message sent
- visible frontend result
- relevant session/process trace/work evidence
- commands used to start the runtime/frontend

## Mattermost Boundary

The current repository must not restore Mattermost plugin package, Mattermost deployment files, Mattermost runtime adapter scripts, Mattermost native frontend entrypoints, plugin proxy routes, or carrier Team/User/Channel/Post ids as product requirements.

# Verification

Use the lightest verification that proves the affected behavior.

Verification includes content review. Do not accept delegated work from status alone.

| Task type | Content gate |
| --- | --- |
| Documentation | Read the changed page(s) and navigation. Check accuracy, omissions, stale wording, and conflict with current product decisions. |
| Code/API/storage | Inspect the PR diff and the key touched files. Check behavior, boundaries, error handling, and tests. |
| UI | Inspect the visible result through browser smoke, screenshots, DOM assertions, or equivalent evidence. |
| Runtime/database | Check runtime events, trace/session evidence, schema/migration results, logs, or database rows as applicable. |

## Branch Or Worktree Verification

Common checks:

```powershell
npm run docs:sync-obsidian
npm run docs:build
npm run check
npm test
```

Use targeted tests when the task touches a specific module. Database/runtime storage work may require migration or schema tests.

## Test Tiers

TinyOffice keeps the default test path on Node's built-in test runner. Do not add a new test framework for ordinary product coverage.

| Tier | Command | Coverage |
| --- | --- | --- |
| TypeScript boundary | `npm run check` | Repository TypeScript contracts and imports. |
| Runtime and API tests | `npm run test:runtime` | `tests/**/*.test.ts`, including company scoping, member identity, owned Chat services/APIs, runtime sessions, Tasks/Schedules/Runs, Access, Prompt Policy, Employee Runtime, PostgreSQL schema/migrations, governance, and developer workflow helpers. |
| Standalone frontend tests | `npm run test:web` | `apps/tinyoffice-web-shadcn/src/**/*.test.ts`, including frontend API client, Chat view models, product model, static boundary checks, Sessions, and Tasks rendering helpers. |
| Full branch test gate | `npm test` | Runtime/API tests followed by standalone frontend tests. Use this for PR evidence unless the accepted task scope explicitly narrows verification. |
| Standalone frontend build | `npm run build:tinyoffice-web-shadcn` | Frontend TypeScript and Vite production build. |
| Product smoke | `npm run smoke:no-carrier-chat` and `npm run smoke:standalone-frontend-browser` | Owned Chat runtime and standalone browser behavior. These do not prove retired Mattermost/native Console surfaces. |

When counting or auditing tests in a dependency-linked worktree, use Git-tracked file lists instead of blind recursive filesystem scans. The dependency links can make `node_modules` point back into the checkout.

```powershell
$files = git ls-files | Where-Object { $_ -match '^(tests/.*\.test\.ts|apps/tinyoffice-web-shadcn/src/.*\.test\.tsx?)$' }
$files.Count
```

For user-visible collaboration/runtime changes, branch verification is not final acceptance. State in PR evidence when live mainline runtime smoke is deferred to post-merge `main`.

## Documentation-Only Verification

For docs-only changes:

```powershell
npm run docs:sync-obsidian
```

Run `npm run docs:build` when navigation, links, deleted pages, or local preview behavior may be affected.

For Company tenant-boundary documentation changes, add targeted text scans that prove changed docs require an explicit `companyId`, reject hidden default/global/single-company fallback, and distinguish preserved capability assets from resettable runtime/business state.

For Company lifecycle documentation changes, add targeted text scans that prove Mattermost Team is not described as a user-created or user-bound product object, standalone Team binding/setup fallback is retired, unbound Teams are invalid state rather than a repair flow, and Company Blueprint is only an internal template rather than a hidden Company or runtime history.

## Evidence

PR or final evidence should include:

- changed scope
- commands run
- pass/fail result
- skipped verification and reason
- whether main smoke is required

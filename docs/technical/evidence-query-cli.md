# Evidence Query CLI Technical Implementation

This page records the implementation boundary for `agentco query`.

## Entry Points

- CLI adapter: `src/cli/evidence-query-cli.ts`
- Agent CLI dispatcher: `src/cli/agentco.ts`
- Query service: `src/runtime/evidence-query/evidence-query-service.ts`
- Tests: `tests/runtime/evidence-query-cli.test.ts`

The command is invoked as:

```bash
node --import tsx src/cli/agentco.ts query <command> [options]
```

## Storage Boundary

The service accepts repository/store interfaces and does not execute SQL directly.

Current data sources:

| Evidence domain | Source |
| --- | --- |
| Employees/runtime config and Company Directory | `CompanyDirectoryRepository` |
| WorkTask/WorkSchedule/WorkRun/events | `WorkRepository` |
| Session records/events, Process Trace, collaboration actions, memory | `RuntimeSessionRepository` |
| Approvals/grants | `ApprovalRepository` over `PostgresCompanyGovernanceStore` |
| Intake events | `DbIntakeEventStore` |
| Operating events | `OperatingLogRepository` |

## Output Shape

All successful results return:

- `ok: true`
- `query`
- `generatedAt`
- `summary`
- `items` for list queries or `detail` for detail queries
- optional `evidence` / `links`

Errors are handled by `agentco.ts`, which prints `{ ok: false, error }` and exits non-zero.

JSON is the default renderer. `--summary` returns `result.summary` only.

## Implemented Query Behavior

- `member-state` aggregates runtime-capable member identity, WorkTasks, WorkSchedules, WorkRuns, sessions, actions, approvals, grants, ops events, and memory summaries.
- `work-run` returns the WorkRun, related WorkTask, optional WorkSchedule context, and WorkRun events.
- `session-input` filters session events to user message, prompt context, and model input records.
- `trace` supports WorkRun, session record, and member filters. Session filtering uses the session record's `sessionKey`.
- `actions`, `intake`, `approvals`, `grants`, `ops`, and `memory` are filtered through their repositories or stores.
- CLI filters use `memberId` / `--member`. Runtime repositories may still use `employeeId` parameters internally for Session, Process Trace, collaboration action, and memory evidence because those fields describe the executing runtime-capable member.

## Verification

Focused verification:

```bash
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests/runtime/evidence-query-cli.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

`npm run check` can fail in short-lived Windows worktrees if dependency shims are not linked into `node_modules/.bin`. In that case, run TypeScript through `node node_modules/typescript/bin/tsc --noEmit`.

## Non-Goals

- No raw SQL interface.
- No realtime polling loop.
- No Prompt Policy UI or Employee Config / AGENTS.md single-source changes.
- No heavy permission engine inside this CLI.

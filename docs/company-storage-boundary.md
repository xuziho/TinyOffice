# Company Storage Boundary

This page defines the TinyOffice storage boundary and the zero-residue cleanup target.

## Current Decision

TinyOffice runtime storage is PostgreSQL-first and must converge to PostgreSQL-only for shared company state. Runtime services must provide `TINYOFFICE_DATABASE_URL` and fail fast when it is missing.

Company is the first boundary for shared runtime truth. Runtime and Operations Surface paths must resolve an explicit `companyId` before loading shared truth. Missing `companyId` is an error, not permission to fall back to a global, default, or legacy single-company store.

## Active PostgreSQL Truth

The active product truth belongs in PostgreSQL-backed repositories for:

- Company and Company-scoped configuration
- Member / runtime-capable employee configuration
- Channel, Topic, Conversation, Message, Participant, unread/read state, mentions, and attachment metadata
- Prompt Policy and Access policy
- Intake events
- WorkTask, WorkSchedule, WorkRun, WorkRun events, and dispatch leases
- Session records and session events
- Process Trace events
- Collaboration action events
- Memory summaries
- Operating events
- Replay/idempotency ledgers

Some current tables still contain `employee` wording where the owning product slice has not been renamed yet, such as runtime/session evidence surfaces. Governance Approval, ApprovalGrant, Work, Chat, and Operating Log records use member identity at the product storage boundary. Remaining names are current implementation debt to audit by slice, not permission to add compatibility aliases or historical migration chains. New product code must not depend on carrier-native ids as truth.

## Retired File Sources

Retired shared runtime or native Console truth must not be recreated as runtime fallback, seed input, export input, hidden compatibility path, or diagnostic-only read.

Examples:

- employee profile/runtime/resource JSON files
- prompt block JSON/Markdown runtime sources
- tool guard policy JSON runtime sources
- participant file seeds
- `.data` runtime ledgers
- `.data/company.db` and related backups/tmp files

When old files are removed, a runtime error is useful evidence because it exposes an unfinished migration path. Silent fallback is not acceptable.

## May Stay As Files

These files are not shared runtime truth and should not be forced into PostgreSQL:

| File Area | Why It Stays Outside PostgreSQL |
| --- | --- |
| `src/`, scripts | Source code and development tools belong in Git. |
| `docs/` | Product and technical manual, not runtime state. |
| `companies/<companyId>/skills/**/SKILL.md` | Company-scoped workflow knowledge shared by employees in exactly one Company. |
| `companies/<companyId>/employees/<employeeId>/skills/**` | Employee-local skill/runbook source files. |
| `companies/<companyId>/employees/<employeeId>/AGENTS.md`, `CLAUDE.md`, or workspace-local context files | Local employee guidance loaded as runtime context. |
| `companies/<companyId>/employees/<employeeId>/workspace/**` | Employee working files and generated artifacts. |
| `.scratch/` | Temporary investigation and smoke evidence. |
| `.runtime/` | Local process logs, pid files, smoke artifacts, and rendered debug files. |

## Cleanup Checklist

1. Keep PostgreSQL tables as the only shared runtime truth, scoped by Company.
2. Keep Employee Config reads/writes on PostgreSQL-backed repositories.
3. Keep Prompt Policy reads/writes on PostgreSQL.
4. Keep Access policy reads/writes on PostgreSQL.
5. Keep Company Members and Chat Participants on PostgreSQL-backed member/participant stores.
6. Remove legacy `.data` runtime state files and all code paths that read them.
7. Make missing PostgreSQL data fail fast with a clear error instead of reading files.
8. Make missing `companyId` fail fast with a clear error instead of using a hidden default Company.
9. Reset current dev/test runtime data when needed; do not preserve old single-company runtime data, historical PostgreSQL migration chains, or compatibility fallbacks.
10. Preserve Company and Employee Skill assets under `companies/<companyId>/**` plus product documentation under `docs/**`; TinyOffice system operations remain code-backed capabilities rather than user-managed system Skills.
11. Update docs and tests in the same change so no product page describes deleted file-backed truth.

## Placement Rule

Put data in PostgreSQL when it is shared company state, runtime state, routing state, Work, session/event evidence, approval/access, audit, binding, prompt policy, tool safety, employee config, participant data, or operating log.

Put data in files only when it is source code, product documentation, skill/runbook source, employee workspace material, local development evidence, local operator sentinels, or external-system state.

Resolve Company before applying this rule. If a request cannot identify the active Company, stop with an explicit error rather than reading a global singleton.

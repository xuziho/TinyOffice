# Feature Inventory

This page is the current capability index for TinyOffice. It records stable product facts and points later development to the right product or technical page.

## Maintenance Rules

- If code already has a stable capability, it should have an owner here.
- If code and product judgment disagree, update the stable product page or create an Issue.
- TinyOffice is a company-operations foundation. Vertical business capabilities belong in employee tools, Skills/Runbooks, or external adapters unless they are truly core runtime infrastructure.

## Foundation Capabilities

| Area | Capability | Current judgment | Main docs |
| --- | --- | --- | --- |
| Standalone frontend | React app foundation at `apps/tinyoffice-web-shadcn` | Foundational product frontend path; opens outside port `8065` and uses TinyOffice runtime APIs. | [Operations Surface](../product/console.md), [TinyOffice Web](../technical/tinyoffice-web.md) |
| Conversation / Message backend | PostgreSQL-backed TinyOffice Conversation, Message, Chat Projection, and Chat create-entry services | Current Chat/Message foundation. New work must use TinyOffice-owned APIs and DTOs, not Team/User/Channel/Post carrier contracts. | [Conversation / Message Contract](../technical/conversation-message-contract.md), [Chat Entry Contract](../technical/chat-entry-contract.md) |
| Realtime | Chat/Message events, projection updates, runtime dispatch visibility, and external intake event envelope | Core routing and evidence entry. | [Realtime Intake](../product/realtime-intake.md), [Intake Event Contract](../intake-event-contract.md) |
| Employees | Employee identity, runtime config, sessions, memory, skills | Core employee runtime. | [Employee Config](../product/employee-config.md), [Sessions](../product/sessions.md) |
| Work | WorkTask, WorkSchedule, WorkRun, queue, dispatch, blocker recovery, Tasks | Core background work model. Repository storage is split; Tasks is the product-facing surface. | [Work System](../product/work-system.md), [Tasks](../product/tasks.md) |
| Operations Surface | Tasks, Sessions, Employees, Company, Prompt Policy, Settings, Doctor, developer-gated Access | Current top-level shadcn operations modules. Employee runtime status is lightweight Chat context, not a separate daily Status page. | [Operations Surface](../product/console.md), [Company Config](../product/company-config.md) |
| Access | Sensitive resource and high-risk command policy, backend Access request/grant records, foreground Chat approval cards | Access Policy and request resolution are current. Keep narrow and do not expand into business-action approval. | [Access](../product/tool-safety.md), [Access Requests](../product/approval.md) |
| Evidence | Process Trace and Operating Log | Runtime evidence; not separate business apps. | [Process Trace](../product/process-trace.md) |
| Data | PostgreSQL company and runtime truth | Shared runtime source of truth. | [Company Storage Boundary](../company-storage-boundary.md) |
| PI baseline | Web tools, low-level tool guard, Context Harness, provider diagnostics | Employee capability substrate. | [System Map](system-map.md) |

## Access Boundary

Access currently covers:

- environment config
- secrets and credentials
- deployment and runtime config
- generated/dependency directories
- dangerous commands

Access does not cover:

- every possible AI business action
- ordinary Channel creation
- ordinary article drafting or publishing workflow steps unless they touch a sensitive resource
- employee role responsibilities
- Runtime-side execution of business continuation after approval

Approved Access requests create scoped grants. The Access request queue supports allow-once, allow-in-context, and reject decisions so the original employee/session can retry the blocked tool path and then use the normal final scene output.

## Implementation Owners

| Capability | Main implementation |
| --- | --- |
| Standalone frontend | `apps/tinyoffice-web-shadcn` |
| Realtime | `src/runtime/realtime`, `src/collaboration/realtime` |
| Employee runtime | `src/runtime` |
| Work system | `src/work` |
| Access policy UI/API | `src/runtime/company-config/tool-guard-admin.ts` |
| Access request storage | `src/governance` |
| Low-level tool guard | `packages/pi-tool-guard` |
| PostgreSQL runtime config | `src/runtime/company-config` |

## Follow-Up Method

When a capability is discovered in code but not documented:

1. Add one row here.
2. Record current implementation and product judgment.
3. If stable, link or create the product/technical page.
4. If disputed, create an Issue and keep this page factual.
5. Run `npm run docs:build`.

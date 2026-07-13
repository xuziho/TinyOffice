# System Map

This page maps TinyOffice product layers, core objects, code modules, and data boundaries.

For a source-tree audit with module size, concentration risks, and placement rules, see [Source Architecture Map](source-architecture-map.md).

## Product Layers

```text
Standalone TinyOffice frontend
  -> TinyOffice API and company coordination layer
  -> Chat / Message and realtime layer
  -> Employee runtime layer
  -> PI capability layer
  -> PostgreSQL data foundation
```

| Layer | Owns | Does not own |
| --- | --- | --- |
| Standalone TinyOffice frontend | Product Chat in `apps/tinyoffice-web-shadcn`, plus target operations modules as they are rebuilt in shadcn. | Legacy carrier UI, plugin root components, App Bar entries, post renderer surfaces, or port `8065` product entry. |
| TinyOffice API and company coordination layer | Company, Employees, Conversation, Message, Work, Access requests, handoff, records, config, and dispatch. | Carrier-native DTOs as product contract. |
| Chat / Message and realtime layer | Conversation, Message, Chat Projection, room messages, read state, and frontend-visible events. | Old Team/User/Channel/Post identity shapes. |
| Employee runtime layer | Employee identity, collaboration actions, skills, and soft constraints around PI agents. | A complex HR or permission matrix. |
| PI capability layer | Web Search, Web Fetch, low-level tool guard, Context Harness, and memory recall. | Company business model. |

## Core Scenes

| Scene | Product meaning | Current code entry |
| --- | --- | --- |
| Chat | TinyOffice-owned Conversation and Message surfaces with explicit Company and Member context. | `src/collaboration/message`, `src/collaboration/chat`, `apps/tinyoffice-web-shadcn` |
| Channel / Topic | Formal company collaboration rooms and focused discussions. | Current preview in Chat; formal model is being rebuilt in TinyOffice-owned tables and APIs. |
| DM Session Entry | A focused one-to-one Chat entry that can wake a runtime-capable employee. | `src/collaboration/chat`, runtime dispatch |
| Intake | External automation, monitor, or connector signal. | `intake_event`, `sessionKey = employeeId|intake_event|intakeEventId` |
| Work | Background work described by WorkTask, triggered by WorkSchedule when needed, and executed by WorkRun. | `src/work`, `work_run_execution` |

## Core Objects

| Object | Meaning | Main location | Boundary |
| --- | --- | --- | --- |
| Company | Product tenant and operations boundary. | PostgreSQL, `src/runtime/company-config` | No hidden default-company fallback for product APIs. |
| Member | Product identity visible in Chat, access, and collaboration. | `company_members`, `src/collaboration` | Not always runtime-capable. |
| Employee | Runtime-capable member with role, runtime config, and Company-scoped local assets. | `companies/<companyId>/employees/<employeeId>/`, `src/runtime`, PostgreSQL | Not a one-shot bot call. |
| Session | Continuous employee context for a scene. | `src/runtime/pi`, `src/runtime/storage` | Different DM/Topic/WorkRun sessions must not bleed together. |
| Conversation / Message | TinyOffice-owned collaboration memory and public DTO contract. | `src/collaboration/message` | Does not expose carrier ids. |
| Channel / Topic | Shared participant scope and focused discussion scope. | Product model in progress | Formal participant management is next. |
| WorkTask | Reusable background work definition: objective, owner, success criteria, and operating context. | Product model; repository storage uses `work_tasks`. | Does not define trigger cadence or execution history. |
| WorkSchedule | Optional trigger rule that creates WorkRuns from a WorkTask. | Product model; repository storage uses `work_schedules`. | Does not own task objective or execution result. |
| WorkRun | One background execution instance. | `src/work` | Does not define long-term schedule rules or task objective. |
| Approval | Storage object for Access requests and temporary grants. | `src/governance` | Not broad business-action approval. |
| Process Trace | Employee execution event stream. | `src/runtime`, `src/runtime/storage` | Does not replace the main readable thread. |
| Operating Log | System or operations event without a specific WorkRun. | `src/operating-log` | Not every low-level execution step. |

## Code Modules

| Module | Current responsibility | Main path |
| --- | --- | --- |
| Collaboration actions | Employee-callable action specs, schemas, policies, runtime interfaces. | `src/collaboration` |
| Conversation / Message services | TinyOffice-owned Chat and collaboration memory. | `src/collaboration/message`, `src/collaboration/chat` |
| Realtime | Chat/Message events, projection updates, runtime dispatch visibility. | `src/runtime/realtime`, `src/collaboration/realtime` |
| Access request storage | Approval records and scoped grants for foreground Access requests. | `src/governance` |
| Employee runtime | Persistent employee agent, session explorer, runtime storage. | `src/runtime` |
| Work system | WorkTask, WorkSchedule, WorkRun, dispatch, lease, execution, blocker recovery, Tasks. | `src/work` |
| Company config | Prompt blocks, employees, Access, and PostgreSQL runtime config. | `src/runtime/company-config` |
| Operations surface | Standalone frontend and company-scoped TinyOffice APIs. | `apps/tinyoffice-web-shadcn`, `src/api/tinyoffice-api` |
| PI packages | Reusable PI baseline capabilities. | `packages/pi-*` |

## Main Flows

Chat runtime reply:

```text
Frontend Chat composer
  -> TinyOffice API
  -> MessageService transaction
  -> runtime dispatch
  -> employee session
  -> AI reply message
  -> realtime projection update
```

Work execution:

```text
finish_intake_turn create_work
  -> WorkTask
  -> optional WorkSchedule
  -> WorkRun queued
  -> dispatch loop / dispatch lease
  -> employee work_run_execution session
  -> done / blocked / failed / canceled
  -> Tasks / recovery controls
```

Configuration:

```text
Operations Surface
  -> company-config admin
  -> PostgreSQL runtime storage
  -> runtime reload / next session load
```

## Data Boundary

Retired carrier data is not the current product fact store.

| Area | Meaning | Git policy |
| --- | --- | --- |
| `docs/` | Stable product memory and development index. | Commit. |
| `src/` | TinyOffice runtime code. | Commit. |
| `apps/tinyoffice-web-shadcn` | Standalone product frontend. | Commit. |
| `company/` | Skills, runbooks, templates; not runtime config truth. | Commit or template based on sensitivity. |
| `companies/<companyId>/employees/<employeeId>/` | Employee local assets and workspace. | Commit only clean sample assets; runtime `.pi/`, `.scratch/`, and generated workspace data stay local/ignored. |
| `.data/` | Local migration/backup/runtime state material. | Do not commit. |
| `.logs/` | Local runtime logs. | Do not commit. |
| `.scratch` | Temporary investigation and build artifacts. | Do not commit. |

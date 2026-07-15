# Product Model and Source Alignment

This page records current implementation alignment for TinyOffice product models. It is a status page, not the source of product model truth.

Stable product objects are defined in [TinyOffice Product Models](../product/product-models.md). Development rules are defined in [TinyOffice Foundation Development Principles](../developer/foundation-development-principles.md).

## Purpose

Use this page to answer:

- Which product models already have code behind them?
- Which frontend surfaces have been productized?
- Which models still need a follow-up slice?
- Which retired semantics are only legacy evidence?

Do not use this page to invent new product models. If a new model is accepted, update the product model page first.

## Product Skeleton Alignment

| Layer | Current code area | Current state | Risk / next check |
| --- | --- | --- | --- |
| Frontend UI | `apps/tinyoffice-web-shadcn` | Standalone React/Vite frontend is the current product frontend for Chat, Tasks, Sessions, Integrations, Company lifecycle, Employees, Settings, and developer-gated System AI, Prompt Policy, Access, and Doctor. | Keep product-specific behavior in focused page/components rather than turning the app shell or Chat hook into a catch-all. |
| TinyOffice API | `src/api`, `src/server` | Product APIs exist for Chat projection, room messages, runtime preview, Tasks, and related data. | Keep splitting route handlers by product module as Channel, Sessions, Tasks, and configuration surfaces grow. |
| Chat / Message | `src/collaboration` | Conversation, Message, Chat Entry, projection, room read/reply, mark-read, and realtime events exist. | Continue rejecting public carrier ids in DTOs. |
| Runtime Dispatch | `src/runtime/realtime`, `src/runtime/orchestration` | Chat messages can trigger employee runtime replies through TinyOffice-owned dispatch. | Audit remaining root-post or carrier terminology before expanding Topic/Tasks features. |
| Company Runtime | `src/runtime`, `companies/<companyId>` | Employees, sessions, provider adapter, tool packages, and runtime evidence exist. | Keep provider-specific Pi behavior behind adapter boundaries. |
| Realtime | `src/collaboration/contracts`, realtime gateway code | TinyOffice-owned socket.io events exist for Chat projection/read/message updates. | Runtime status, streaming drafts, cancel, WorkRun status, and trace summaries need consistent frontend event mapping. |
| PostgreSQL | `src/runtime/company-config/postgres-schema.ts`, repositories | Unified TinyOffice fact database is the current product truth. | Old single-company files and carrier-native databases must not re-enter product runtime as fallback. |

## Current Product Model Status

| Product model | Source alignment | Frontend state | Status |
| --- | --- | --- | --- |
| Company / Workspace | `companies`, `company_members`, explicit company-scoped APIs. | Current-session, workspace header context, shadcn Company lifecycle, single-Owner passkey authentication, and local one-time access exist. Ongoing System AI configuration is developer-gated and separate. | First version usable within the accepted single-Owner authentication boundary. |
| Company Member | Company directory and member metadata exist. | Directory, DMs, Context enrichment. | Usable for display and participant enrichment. |
| Employee / Runtime-capable Member | `employees`, runtime configs, employee home, provider/session storage. | DMs and runtime status. | Main Chat reply path works; no hidden fallback allowed. |
| Channel | `chat_channels` and `chat_channel_members` are the formal truth, with create/list/add-member/remove-member/dissolve API support. Channel membership is a thin participant list, not an owner/admin/member permission layer. | Chat shows Channels, topic lists, Channel Context participants, and basic Channel management. | Usable first version; dissolve authorization is company-level policy, not Channel member role state. |
| Channel Participant | Channel membership rows preserve exactly one identity: `member_id` for a company member. | Channel Context participants and Channel Topic participant projection. | User-visible label should be Participants; code must not reintroduce employee-id aliases or Channel membership roles. |
| Topic | Topic rows and Chat Entry topic rooms exist. | Channel topic list and opened Topic room. | Partially productized; must remain under real Channel membership. |
| Handoff / Single-ball Owner | Channel Topic turns require exactly one `handoff_topic_turn`; selecting the user returns the ball, while selecting an executable participant continues the chain. | Topic ownership, active participant state, stop control, and Activity evidence are integrated into Chat rather than exposed as a separate Handoff screen. | Current single-ball Topic flow is implemented. |
| DM Container | Projection can expose member/employee DM containers. | Left DMs and member page. | Usable first version. |
| DM Session Entry | Direct conversations can be opened as concrete rooms. | DM Chats list and opened DM room. | Main user-message -> AI-reply path works. |
| Conversation | `conversations` and participant state exist. | Open room. | Usable. |
| Conversation Participant | Room-level participant/read-state exists. | Room Context and unread/mentions. | Usable first version. |
| Message | `conversation_messages` exists with sender/body/metadata. | Message timeline. | Usable. |
| Runtime Dispatch | Chat turn dispatch wakes the resolved DM peer or the single selected Topic participant. | Replies, streaming state, retry convergence, stop control, and participant presence are visible in Chat. | Current first product chain and its state-convergence paths are implemented; future work should be driven by new reproduced failures. |
| Runtime Status / Presence | Runtime/realtime evidence can support lightweight state. | Active/failed presence exists. | Needs more complete UX, but must not become fake messages. |
| Session Record | `session_records` and `session_events` exist. | Chat Context can expose Session evidence links and shadcn Sessions provides the primary inspection surface. | Keep exact-detail navigation tied to owned Session ids and employee context where needed. |
| Process Trace | Trace events exist. | Context summary slot only. | Details should remain in Sessions until a standalone Trace destination is accepted. |
| WorkTask / WorkSchedule / WorkRun | Work repository storage is split into tasks/schedules/runs; dispatcher, Process Trace, and Tasks view model use `workTaskId`. | Chat Context can expose WorkRun evidence links and shadcn Tasks is the primary foreground Task surface. | Data-model slice landed; product-facing Tasks naming is active. |
| Attachment / File | Message metadata and runtime links exist. | Composer boundary and Context Files slot. | Full upload/storage/preview/model-ingestion not done. |
| Module alerts | Chat projection owns unread/mention counts; Tasks owns failed and dispatch-failed execution state. | Lightweight indicators on the Chat and Tasks rail icons, with concrete rows in the owning module. | No separate Attention projection, API, or inbox exists. |
| Access Policy | Tool safety/governance policy exists. | shadcn Access surface is available as the `/access` rail module. | Backend/config model exists. |
| Access Request | Governance approval/grant records exist. | Foreground Chat Access cards can resolve pending requests; developer-gated Access remains the policy/debug surface. | Keep Access narrow: sensitive resources and high-risk commands only, not broad business approval. |
| Search / History | Directory-level search exists; evidence queries partially exist. | Left search. | Full message/file/session/trace search pending. |
| Settings / Employee Config / Prompt Policy | Runtime config and prompt policy modules exist behind company-scoped APIs. | Employees, Prompt Policy, Settings, and developer-mode toggles have shadcn surfaces. | Keep employee runtime configuration in Employees; keep daily Chat context lightweight. |

## Known Boundary Risks

| Risk | Why it matters | Follow-up |
| --- | --- | --- |
| Product/status/principle docs drifting together | Future agents may treat temporary status as product truth. | Keep stable product models in `docs/product/product-models.md`; keep implementation status here. |
| Oversized frontend files | Large view model and CSS files make Chat changes harder to reason about. | Plan product-slice refactors before adding large new Chat behavior. |
| Legacy carrier wording in current docs or code | Old ids can become accidental product identity. | Use [Legacy Residue Audit](legacy-residue-audit.md). |
| Channel and Topic management surface not complete | Formal Channel member removal and role change exist through explicit API/client boundaries, but management is intentionally not exposed as daily Chat clutter. | Add any dedicated Channel/Topic management surface only through explicit API/runtime/admin boundaries. |
| Session evidence identity needs explicit owned ids | Chat Context and Sessions should navigate through owned session/work/run ids rather than carrier or display-name guesses. | Keep Chat Context evidence factual and compact; enrich backend links only where a real destination exists. |

## External Reference Boundary

Retired carrier behavior is outside the current product path. New product work must use TinyOffice-owned models, APIs, realtime events, and PostgreSQL truth.

# TinyOffice Product Models

This page records the stable TinyOffice product objects. It answers what the product is, not the current implementation status.

Current implementation status belongs in [Product Model and Source Alignment](../status/product-model-and-source-alignment.md). Development principles belong in [TinyOffice Foundation Development Principles](../developer/foundation-development-principles.md).

## Product Skeleton

TinyOffice is a company-operations foundation built as a modular monolith.

```text
Frontend UI
  TinyOffice-owned standalone frontend and operations surfaces

TinyOffice API
  Product APIs for Company, Member, Chat, Work, runtime, policy, and evidence

Chat / Message / Work / Governance modules
  Product services for collaboration, background work, permissions, and records

Runtime Dispatch / Company Runtime
  Employee identity, sessions, provider adapters, tool policy, trace, and execution

Realtime
  TinyOffice-owned state delivery for Chat, runtime, work, and evidence updates

PostgreSQL
  Unified fact database for product state and runtime evidence
```

Retired carrier systems are not part of this product skeleton.

## Final Runtime Architecture

TinyOffice's target runtime shape is a company control plane with isolated employee runtime daemon ownership. This is an architecture principle, not a claim that every current development runtime already runs as a separate OS process. A local implementation may host several daemon objects in one process, but new Work, Schedule, Runtime, Session, and Process Trace implementation should preserve the ownership boundary.

```text
Frontend Web
  User-facing TinyOffice interface.

TinyOffice API / Realtime Service
  Product API and WebSocket entry for Company, Member, Chat, Work, Access, runtime configuration, sessions, and evidence.

Company Control Plane
  Company-scoped resident orchestration for schedule ticks, WorkRun creation, dispatch, runtime health, operating log, and recovery.

Employee Runtime Daemons
  Runtime-capable members run through isolated daemon/worker ownership. Each daemon ownership boundary holds one employee identity, session continuity, workspace, skills, prompt context, tool boundary, and final-result protocol.

PostgreSQL
  Unified fact database for company, member, chat, work, schedule, session, trace, policy, and runtime evidence.

Employee Home / Workspace Assets
  Company-scoped file assets such as workspace files, skills, AGENTS.md guidance, drafts, and generated materials.
```

The API process may host multiple modules or local daemon objects, but product design must not collapse employee runtime ownership into ordinary request handlers. A request handler can ask the control plane to wake or dispatch an employee; it should not become the employee runtime identity itself.

## Core Models

| Product model | Product meaning | User-visible surface | Boundary |
| --- | --- | --- | --- |
| Company / Workspace | The tenant boundary for members, employees, chats, work, permissions, and evidence. | Workspace header and Company rail module. | Product runtime must receive explicit company context. |
| Company Member | A product identity: boss, collaborator, reviewer, operator, or runtime-linked person. | Directory, DMs, participants, Context enrichment. | Not every member is an executable employee. |
| Employee / Runtime-capable Member | A member with persistent runtime identity, configuration, tools, sessions, and provider execution. | DMs, runtime status, Sessions, Tasks. | Must be explicitly bound; no hidden member-to-employee fallback. |
| Channel | A multi-participant collaboration directory. | Chat left Channels list; channel directory page; Context participants. | A Channel is not a message timeline and does not maintain a separate owner/admin/member role system. Topics are the concrete chat entries. |
| Channel Participant | A person who can see or participate in a Channel. | Channel Context participants. | User-facing language is Participants; persistence may use membership rows. |
| Topic | A concrete discussion entry under a Channel. | Channel Topics list; opened Topic room. | Must belong to a real Channel; default visible participants come from the Channel. |
| Handoff / Single-ball Owner | The current responsible participant in a Topic and the transfer of responsibility to the next person. | Future Topic status and handoff UI. | Topic ownership is not the same thing as WorkRun lifecycle. |
| DM Container | A one-to-one directory for a member/employee. | Chat left DMs list; member detail page. | The container is not itself the reply room. |
| DM Session Entry | One concrete one-to-one chat instance under a DM Container. | DM Chats list; opened DM room. | This is the room that can trigger employee runtime replies. |
| Conversation | A readable/writable message room. | Open DM Session Entry or Topic room. | Channel containers and DM containers are not conversations. |
| Conversation Participant | A participant and read-state relationship inside a concrete Conversation. | Room Context participants, unread, mentions. | Different from Channel Participant; one is room-level, one is channel-level. |
| Message | Durable chat content visible to people and employees. | Message timeline. | Runtime processing status is presence/evidence, not ordinary message history. |
| Runtime Dispatch | The product decision of whether a message wakes an employee, which employee, and under which scene/session. | Indirectly visible through replies and presence. | Must use TinyOffice identity and provider adapter boundaries. |
| Runtime Status / Presence | Lightweight live state such as received, active, failed, or completed. | Message area presence near the employee identity. | Do not persist these as normal chat messages. |
| Session Record | A durable runtime session for an employee. | Chat Context summary; Sessions page. | A Session is not a Chat room. |
| Process Trace | Runtime evidence: stages, tool calls, errors, completion, and related evidence. | Chat Context summary slot; Sessions detail. | Trace details are evidence/context, not chat identity. |
| WorkTask | A background work item with goal, owner, success criteria, and verification criteria. | Tasks Work list. | Not automatically created from every chat; does not own long-term schedule state. |
| WorkSchedule | A trigger rule for creating WorkRuns from a WorkTask. | Tasks selected Work detail. | Stores when/how often to trigger; it references a WorkTask and does not duplicate the task body as identity. |
| WorkRun | One execution instance of a WorkTask. | Tasks selected Work detail and related Context evidence. | WorkRun owns execution lifecycle, blockers, failure, completion, result, session, and trace links. |
| Attachment / File | Files attached to chat or available as context. | Composer boundary, message metadata, Context Files slot. | Full upload/storage/preview/model-ingestion is a separate slice. |
| Module alert | A lightweight signal that Chat has unseen conversation activity or Tasks has failed execution controls. | Chat or Tasks rail icon, then the owning rows inside that module. | It is not a separate inbox, persisted object, or cross-module aggregation API. |
| Access Policy | Rules for sensitive resources, dangerous actions, and approval requirements. | Access rail module. | This is policy configuration, not a request inbox. |
| Access Request | A concrete request raised when an employee touches a sensitive resource or command. | Foreground card in the owning Chat room. | Chat owns the alert and decision flow; Access remains policy/configuration. |
| Search / History | Search across members, channels, topics, messages, files, sessions, trace, and work. | Chat search now; future broader search surfaces. | Current Chat search is navigation-level only. |
| Company / Employee Runtime / Prompt Policy / Access | Company, employee runtime, prompt, model, tool, and governance configuration. | Top-level rail modules. | Keep configuration controls in their dedicated top-level product modules. |

## Non-Negotiable Model Boundaries

- Channel is a directory and permission boundary; Topic is the concrete room under it.
- DM Container is a directory; DM Session Entry is the concrete one-to-one room.
- Participants is user-facing language; Channel membership and Conversation participation are distinct persistence relationships.
- Message is durable conversation content; runtime status is presence or evidence.
- Session, Process Trace, WorkRun, and Attachment are Context/evidence objects, not Chat identity.
- Access Policy belongs to the Access rail module; Access Request is the foreground approval object for low-level ask decisions.
- Chat and Tasks own their own lightweight rail indicators. TinyOffice has no separate Attention product object or operational inbox.
- Channel management UI is not part of the current daily Chat slice. Channel create, invite, and remove capabilities may exist behind APIs or tools, but Channel member role changes are not part of the product model.
- Company Control Plane is the resident owner of schedule ticks, WorkRun dispatch, and runtime recovery.
- Employee Runtime Daemon ownership is per runtime-capable member; runtime identity must not be reduced to a generic API request handler.
- WorkTask, WorkSchedule, and WorkRun are distinct product objects. Do not re-bundle schedule rules into task identity or treat a Run as only `lastRun` fields on a task.

# TinyOffice Modular Monolith Direction

This page is product truth for TinyOffice architecture direction. It records the chosen product shape so future agents do not need chat history to decide service boundaries, frontend ownership, or database foundation.

## Chosen Shape

TinyOffice is one modular monolith for a personal AI company operating system.

It is one product and one application with clear internal module boundaries. It is not a plan to deploy many independent services, and it is not a microservice split disguised as product architecture. Frontend/backend code boundaries are necessary, but the current target is one coherent TinyOffice product surface backed by one runtime and one product fact database.

The stable internal layers are:

| Layer | Product role | Boundary rule |
| --- | --- | --- |
| Frontend UI | TinyOffice-owned user and operator surfaces, including the standalone frontend direction in `apps/tinyoffice-web-shadcn`. | UI reads TinyOffice product APIs and product DTOs. |
| TinyOffice API | HTTP and internal API boundary for Company, Employee, Work, Conversation, Message, runtime policy, and evidence. | API exposes TinyOffice ids and product DTOs. |
| Company Runtime | Employee sessions, WorkRun execution, prompt assembly, tool/access policy, dispatch, and trace capture. | Runtime acts inside an explicit Company and uses TinyOffice product records as truth. |
| Work Memory / Conversation and Message services | Product collaboration memory: Conversation, Message, Participant, Attachment, realtime events, session records, and runtime memory. | Message and conversation behavior follows the TinyOffice-owned contract. |
| PostgreSQL unified fact database | Core TinyOffice fact store for Company, Employee, Session, WorkTask, WorkSchedule, WorkRun, Trace, Conversation, Message, policy, and related state. | PostgreSQL remains the continuing product data foundation. |

These layers are module and ownership boundaries. They are not instructions to create separate deployable services.

## PostgreSQL Product Truth

PostgreSQL is the existing and continuing TinyOffice fact database. Product facts that define the company operating system belong in TinyOffice PostgreSQL-backed storage, including:

- Company and Company-scoped configuration.
- Member runtime identity, runtime configuration, and resource policy.
- Session records, session events, runtime memory, and process trace.
- WorkTask, WorkSchedule, WorkRun, WorkRun events, collaboration actions, approvals, grants, and operating evidence.
- Conversation, Message, Participant, Attachment, and realtime-event state.

## Assets To Reuse

The modular monolith direction reuses existing TinyOffice assets:

- Company Runtime and employee session execution.
- PostgreSQL runtime storage and repositories.
- WorkTask / WorkSchedule / WorkRun, Process Trace, Evidence Query, Prompt Policy, and Access product records.
- The TinyOffice-owned [Conversation / Message Contract](../technical/conversation-message-contract.md).
- The Message Service direction behind `src/collaboration/message/`.
- The standalone frontend direction documented in [Operations Surface](console.md) and [TinyOffice Web Technical Implementation](../technical/tinyoffice-web.md).

Reuse means keeping business logic, runtime behavior, repositories, and tests that fit these boundaries while exposing them through TinyOffice-owned product APIs.

## How To Read Nearby Docs

Use this page as the architecture boundary before reading older product pages.

- [Product Feature Map](feature-map.md) is the feature reading map.
- [Product Models](product-models.md) records stable product objects and boundaries.
- [Product Model and Source Alignment](../status/product-model-and-source-alignment.md) records current code/product alignment and known differences.
- [Conversation / Message Contract](../technical/conversation-message-contract.md) defines the TinyOffice-owned public DTOs and service boundary for collaboration memory.
- [Operations Surface](console.md) records the standalone frontend and operations-surface direction.

# TinyOffice Chat Foundation Architecture

This page records the first-round product architecture decision for the TinyOffice-owned Chat foundation. It is the shared source of truth for the implementation group tracked by #666, #667, #668, #669, #670, #671, and #672.

This is not the complete TinyOffice roadmap. It locks the mainline for the next Chat, Message, runtime dispatch, realtime, and storage slices.

## Decision

TinyOffice Chat moves forward as a TinyOffice-owned product mainline:

```text
TinyOffice App
  -> TinyOffice API
  -> Chat / Message
  -> Runtime Dispatch
  -> Company Runtime
  -> Realtime
  -> PostgreSQL
```

The product boundary is a modular monolith with explicit internal layers. These layers are ownership boundaries, not instructions to split the product into separate deployable services.

| Layer | Product responsibility | Boundary rule |
| --- | --- | --- |
| TinyOffice App | The standalone product surface for Chat, Operations Surface modules, members, work, and runtime evidence. | Lives in `apps/tinyoffice-web-shadcn` and talks to TinyOffice product APIs. |
| TinyOffice API | The HTTP/API boundary for Company, member, Chat, Message, Work, Session, policy, and evidence. | Hono is the TypeScript API framework direction for this path. API DTOs expose TinyOffice product ids and contracts. |
| Chat / Message | Product collaboration memory: conversations, messages, participants, attachments, and Chat projections. | Chat and Message are TinyOffice-owned contracts backed by TinyOffice storage. |
| Runtime Dispatch | The routing boundary from product events to runtime-capable members. | Chat, Work, and Session call provider-neutral dispatch services. They must not depend directly on Pi. |
| Company Runtime | Persistent member runtime execution, sessions, tools, prompt context, access checks, and process trace. | Runtime always executes inside an explicit Company and runtime-capable member identity. |
| Realtime | Product event delivery for Chat, runtime state, work state, and process updates. | Realtime events are TinyOffice-owned contracts. |
| PostgreSQL | The continuing product fact database for Company, member, Chat, Message, Session, Work, trace, policy, and runtime state. | PostgreSQL-backed TinyOffice repositories are product truth. |

## Source Layout Direction

Source layout should make the product layers visible:

| Path | Intended ownership |
| --- | --- |
| `apps/tinyoffice-web-shadcn` | TinyOffice App frontend. |
| `src/server` | Server composition, lifecycle, and process-level wiring. |
| `src/api` | Hono-based TinyOffice API routes, middleware, DTO validation, and request boundaries. |
| `src/realtime` | TinyOffice-owned realtime server, connection model, event contracts, and delivery. |
| `src/collaboration` | Chat, Conversation, Message, participant, projection, and collaboration-domain services. |
| `src/runtime/chat` | Chat-specific runtime dispatch and reply write-back orchestration. |
| `src/runtime/provider` | Provider adapter boundary for Pi and future runtime providers. |
| `src/runtime/storage` | Runtime persistence, session records, trace, memory, and PostgreSQL-backed repositories. |

This layout is a direction for new foundation slices. Existing code can move slice by slice, but each slice should leave the mainline clearer than it found it.

## API Framework Direction

Hono is the TypeScript TinyOffice API framework direction.

This decision means new TinyOffice API work should prefer Hono route modules, typed request boundaries, and product DTOs under the TinyOffice API layer.

When a slice introduces a Hono route for a product capability, it should switch the product caller to that route and retire the stale caller path in the same slice when practical.

## Provider Boundary

Runtime providers must go through an adapter boundary.

TinyOffice product services such as Chat, Work, Session, and Runtime Dispatch must not import, call, or shape their product contracts around Pi directly. Pi is the first runtime provider, not the product architecture.

The provider boundary must preserve:

- provider-neutral runtime requests and result contracts
- explicit Company and runtime-capable member identity
- session and trace evidence owned by TinyOffice
- room/channel final-output validation before visible Chat write-back
- the ability to add Codex, OpenCode, Claude Code, or another future provider without rewriting Chat, Work, and Session product services

Provider-specific details belong behind `src/runtime/provider` and narrow runtime adapter modules.

## Identity Boundary

Product identity is member-first.

`Member` is the product-facing company subject. A person, boss, operator, approver, or runtime-capable worker is a member first. `Employee` is a current runtime-capable member execution identity and storage/runtime selector, not a separate product category opposite Member.

TinyOffice API production requests use a TinyOffice-owned current member session as the product authorization context. The standalone frontend loads that current session from the backend before loading Company directory, Chat projection, room messages, or write endpoints. Production product paths must not treat `companyId`, `memberId`, `viewerMemberId`, `employeeId`, or `viewerEmployeeId` URL parameters as login identity.

Chat identity comes only from the authenticated Owner session. URL-driven `companyId`, `memberId`, viewer, and actor selectors are not login inputs and are ignored or rejected at the structured request boundary. Tests inject an internal authentication provider rather than activating a second product identity mode.

There must be no hidden member-to-employee fallback:

- A Chat, Work, or Session request that needs runtime execution must resolve an explicit runtime-capable member.
- A member-only subject must not silently become an employee.
- Missing runtime capability is an invalid execution state, not a reason to pick a default employee, first employee, or global employee.
- Product APIs should expose member-first data and only include employee/runtime selectors where the current implementation needs them.
- Runtime dispatch may keep a product member as the actor while routing to an explicit runtime-capable target derived from a DM peer, explicit mention, or formal handoff.
- Runtime dispatch refuses execution when a Chat event has only a product member actor and no explicit runtime target.

## Realtime Boundary

Realtime events are TinyOffice-owned product contracts.

They should describe product state changes such as message created, conversation updated, runtime turn started, runtime turn completed, work updated, process trace updated, and access state changed. Product clients subscribe to TinyOffice event contracts.

## Hard-Cut Rule For Implementation Slices

Each implementation slice should hard-cut its own boundary:

1. Add or move the TinyOffice-owned product path.
2. Switch the product caller to the new path.
3. Remove the stale product path in the same slice when practical.
4. Avoid long-term dual implementations.
5. Avoid bridges unless a decision record explicitly accepts the bridge and names its retirement condition.

The point is not to rewrite everything in one large PR. The point is that each small PR should move one boundary to the new mainline and leave fewer duplicate paths behind.

## Issue Group

This first-round foundation group is:

| Issue | Role | Dependency |
| --- | --- | --- |
| #666 | Record this architecture decision before implementation slices begin. | First. |
| #667 | Introduce the Hono TinyOffice API main path for Chat and stable API error handling. | After #666. Can run beside #669 if scopes stay separate. |
| #669 | Introduce the Runtime Provider Adapter and move Pi behind it. | After #666. Can run beside #667 if scopes stay separate. |
| #671 | Productize TinyOffice Chat runtime dispatch and AI reply persistence. | After #667 and #669. |
| #670 | Add TinyOffice realtime runtime status events and Chat status display. | After #671. |
| #668 | Establish formal auth identity and the member / employee boundary. | After #666. Can run beside #667 or #669 if it does not touch the same API/runtime files. |
| #672 | Enforce Chat permissions across API projection and runtime context. | After #668; should also account for #667 and #671 if they already changed the relevant API/runtime paths. |

Recommended first execution path:

```text
#666
  -> #667 and #669
      -> #671
          -> #670

#666
  -> #668
      -> #672
```

This group is the first Chat foundation round, not the whole TinyOffice roadmap. Later rounds should cover Channel/member management, attachments, full-text search, Process Trace product UI, Tasks, Sessions, and Settings.

Follow-up issues should cite this page when deciding whether to keep a route, DTO, event, storage path, identity rule, or provider coupling.

## Related Product Truth

- [Chat](chat.md)
- [TinyOffice Modular Monolith Direction](modular-monolith-architecture.md)
- [Member Identity Model](member-identity-model.md)
- [Realtime Intake](realtime-intake.md)
- [Conversation / Message Contract](../technical/conversation-message-contract.md)
- [TinyOffice Realtime WebSocket](../technical/tinyoffice-realtime.md)

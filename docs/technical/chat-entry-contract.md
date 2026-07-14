# Chat Entry Contract

This page defines the TinyOffice-owned Chat Entry contract for chat containers and concrete chat open targets. It records the product model settled by the standalone Chat frontend, the backend-owned Chat Projection slice, and the backend create-entry command API. This is the mainline Chat foundation after the retired carrier path was archived at branch/tag `archive/mattermost-carrier-baseline-2026-06-24` / `mattermost-carrier-baseline-2026-06-24`.

Mattermost-backed behavior is external historical reference only, not the Chat foundation, product truth, or a required carrier.

The source contract is `src/collaboration/contracts/chat-entry-contract.ts`. The projection service is `src/collaboration/chat/chat-projection-service.ts`, the create-entry service is `src/collaboration/chat/chat-create-entry-service.ts`, and the Chat API route is `src/collaboration/api/chat-projection-api-routes.ts`. Guard tests live in `tests/collaboration/chat-entry-contract.test.ts`, `tests/collaboration/chat-projection-service.test.ts`, `tests/collaboration/chat-create-entry-service.test.ts`, and `tests/collaboration/chat-projection-api-routes.test.ts`.

## Product Meanings

| Term | Meaning |
| --- | --- |
| ChatContainer | A directory-level chat grouping visible to a client. A container is not itself a reply room or timeline. |
| Channel container | A formal channel directory backed by a TinyOffice Channel record and Channel membership. It can contain channel topic entries. |
| Direct Message container | A direct-message directory for one member relationship. DTO kind is `member_dm`. It can contain DM session entries. |
| ChatEntry | A concrete open target inside one container. Entries are what a client opens to see and reply in a room. |
| Channel Topic entry | A channel-scoped entry that opens a topic room. It is not the Channel container itself. |
| DM Session Entry | A DM-scoped entry that opens a DM session entry room. It must not be represented as `ChannelTopic` or `channel_topic`. |
| OpenTarget | The room target that the frontend opens for a ChatEntry. |
| RuntimeLink | Evidence or context linked to a container or entry, such as Session, WorkRun, ProcessTrace, SessionEvent, or Attachment evidence. Runtime links are not chat identity. |

TinyOffice product clients consume Company, ChatContainer, ChatEntry, OpenTarget, and RuntimeLink truth. Retired carrier behavior is not the Chat foundation, product truth, or a required carrier.

## DTO Vocabulary

Public DTOs use TinyOffice ids and product vocabulary only.

Container kinds:

- `channel`
- `member_dm`

Entry kinds:

- `channel_topic`
- `dm_session_entry`

Title status values:

- `placeholder`
- `generated`
- `manual`
- `failed`

Open target kinds:

- `topic_room`
- `dm_session_entry_room`

## Public DTO Contract

All public DTOs carry:

- `schema`
- `version`
- explicit `companyId`
- TinyOffice-owned resource ids such as `containerId`, `entryId`, `parentContainerId`, `roomId`, `messageId`, and runtime `targetId`

Public `ChatContainerDto`:

| Field | Meaning |
| --- | --- |
| `companyId` | Tenant boundary for the container. |
| `containerId` | TinyOffice-owned container id. |
| `kind` | `channel` or `member_dm`. |
| `title` | Display title for the directory-level container. |
| `summary` | Optional display summary. |
| `unreadCount` | Container-level unread projection. |
| `mentionCount` | Container-level mention projection. |
| `entryCount` | Number of concrete entries in this container projection. |
| `runtimeLinks` | Evidence/context links for the container. They do not make the container a runtime object. |

Public `ChatEntryDto`:

| Field | Meaning |
| --- | --- |
| `companyId` | Tenant boundary for the entry. |
| `entryId` | TinyOffice-owned entry id. |
| `kind` | `channel_topic` or `dm_session_entry`. |
| `parentContainerId` | The container directory that owns this entry. |
| `title` | Display title. It may be a provisional placeholder during backend-owned title refinement. |
| `titleStatus` | `placeholder`, `generated`, `manual`, or `failed`. The state is owned by the backend System AI title foundation, not by the frontend. |
| `titleSourceMessageId` | Optional TinyOffice `MessageId` used as source evidence for backend title generation. |
| `summary` | Optional display summary. |
| `unreadCount` | Entry-level unread projection. |
| `mentionCount` | Entry-level mention projection. |
| `openTarget` | Concrete room target. `channel_topic` opens `topic_room`; `dm_session_entry` opens `dm_session_entry_room`. |
| `runtimeLinks` | Evidence/context links. They are not entry identity. |
| `updatedAt` | ISO timestamp from TinyOffice truth. |

Public `ChatRuntimeLinkDto`:

| Field | Meaning |
| --- | --- |
| `companyId` | Tenant boundary for the evidence link. |
| `linkId` | TinyOffice-owned link id. |
| `targetKind` | `session`, `work_run`, `process_trace`, `session_event`, or `attachment`. |
| `targetId` | TinyOffice runtime/evidence id. |
| `label` | Optional display label. |
| `sourceMessageId` | Optional TinyOffice Message evidence anchor. |
| `createdAt` | ISO timestamp from TinyOffice truth. |

## Boundaries

Channel and Direct Message are containers/directories. They are not reply rooms, channel timelines, or identity for any WorkRun, Session, ProcessTrace, or Attachment.

Channel Topic and DM Session Entry are concrete entries. A Channel Topic is channel-scoped and opens a `topic_room`. A DM Session Entry is DM-scoped and opens a `dm_session_entry_room`. A DM Session Entry must not be represented as a Channel Topic.

Runtime links can attach evidence to a container or entry, but they do not change identity:

- WorkRun is evidence/context, not a chat room.
- Session is evidence/context, not a chat room.
- ProcessTrace is evidence/context, not a chat room.
- Attachment is evidence/context, not a chat room.

Attachment runtime links remain evidence links and do not change Chat identity. Separately, Chat v1 supports company-scoped image attachments for `image/png`, `image/jpeg`, and `image/webp`: clients upload images through the Chat attachment route, send immutable `attachmentIds` with a room message or create-entry first message, and render backend preview/download URLs from Message attachment snapshots. Runtime visual understanding is gated by the target employee model's PI registry `input` capability: image-capable models receive PI SDK image prompt options, while text-only models fail before provider execution. General files, GIFs, PDF parsing/OCR, scanning policy, and broader file governance remain follow-up slices.

Channel/Topic context selection is a TinyOffice-owned progressive-disclosure contract. Standalone Chat clients must not expose legacy context-mode switches. Runtime context is assembled by the backend from persisted Conversation messages, System AI Topic summaries, recent-message context budgets, handoff candidates, the current triggering or handoff message, and explicit history lookup tools for older details.

The runtime recent-message budget means "latest N persisted messages", not "first N messages". The repository selects the newest messages first, then the runtime prompt renders that window in chronological order. Topic summaries are stored on the Conversation topic state so they travel with the room contract instead of living in frontend-only state, Session trace text, or legacy ChannelTopic residue.

The contract now supports one explicit entry lifecycle pair for concrete topic rooms: archive and restore. Archive state is persisted on `Conversation.topic.status = "archived"` and the active Chat Projection must hide that room from Channel/DM entry lists. Restore sets the same topic status back to `open`, making the room visible again through active projections. Archiving is not deletion: messages, runtime links, Process Trace evidence, and title state remain attached to the Conversation.

## Backend Projection

The backend-owned projection is exposed as:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/companies/:companyId/chat?viewerMemberId=:memberId` | Return `ChatContainerDto[]` and `ChatEntryDto[]` for the explicit viewer member. |
| `POST` | `/api/companies/:companyId/chat/entries` | Create one concrete Chat entry under an explicit container, send its first message, and return the created entry/open target. |
| `GET` | `/api/companies/:companyId/chat/rooms/:roomId` | Read the Conversation DTO backing a Chat `openTarget.roomId`. |
| `GET` | `/api/companies/:companyId/chat/rooms/:roomId/messages` | List Message DTOs in the opened Chat room. |
| `POST` | `/api/companies/:companyId/chat/rooms/:roomId/messages` | Append a reply in the opened Chat room as an explicit TinyOffice member. |
| `POST` | `/api/companies/:companyId/chat/rooms/:roomId/read` | Mark the opened Chat room read for an explicit TinyOffice member. |
| `PATCH` | `/api/companies/:companyId/chat/rooms/:roomId/title` | Persist a user-authored room title, mark it `manual`, sync the projected Chat Entry title, and refresh visible projections. |
| `POST` | `/api/companies/:companyId/chat/rooms/:roomId/archive` | Archive a concrete topic room, remove it from active Chat entry lists, and refresh visible projections. |
| `POST` | `/api/companies/:companyId/chat/rooms/:roomId/restore` | Restore an archived concrete topic room, return it to active Chat entry lists, and refresh visible projections. |
| `POST` | `/api/companies/:companyId/chat/attachments` | Upload a company-scoped Chat image attachment and return a public attachment DTO. |
| `GET` | `/api/companies/:companyId/chat/attachments/:attachmentId/content` | Serve attachment image bytes for preview or download. |

The response shape is:

```ts
interface ChatProjectionPage {
  containers: ChatContainerDto[];
  entries: ChatEntryDto[];
  nextCursor?: string;
}
```

The `GET` endpoint is read-only. It does not create Channel Topics, create DM Session Entries, send messages, mark entries read, or subscribe to realtime updates. The standalone frontend consumes it as the Chat source of truth.

The projection is derived from the formal Channel model plus the existing Conversation/Message product contract:

- a persisted Channel with at least one member becomes a `channel` container.
- `conversationKind: "topic"` with topic state and a formal `chatChannelId` becomes a `channel_topic` entry under that Channel.
- `conversationKind: "direct"` becomes a `dm_session_entry`.
- `conversationKind: "shared"` is not exposed as a Chat entry, because a container must not become a reply room just because a legacy/shared Conversation exists.
- Conversation participant read/mention state provides entry and container `unreadCount`, `mentionCount`, and the limited `mention`/`unread` attention reasons.
- Conversation runtime links become Chat runtime links. Their target ids remain evidence/context only and never become Chat container or entry identity.
- Existing persisted Conversation/topic titles without title metadata become entry titles with `titleStatus: "manual"` in this projection.
- Conversation title metadata maps to Chat Entry title state: `titleStatus`, `titleSourceMessageId`, and failed generation state are projected without creating fake Chat messages.

Current projection-derived fields:

- Channel container ids use `chat-container-channel-{chatChannelId}` and must be backed by persisted Channel membership.
- Direct Message container ids use `chat-container-member-dm-{memberId}` from the visible direct-message peer.
- Entry ids use `chat-entry-channel-topic-{topicId}` or `chat-entry-dm-session-{conversationId}`.
- `openTarget.roomId` is the existing TinyOffice Conversation id that backs the reply room. Consumers must treat it as an open target, not as container identity.

The Chat room endpoints use the same `openTarget.roomId` as the owned Conversation id. They call the TinyOffice Message Service directly, so reading room messages, sending replies, and marking read do not require Mattermost Team, Channel, User, Post, root-post ids, plugin routes, `conversation_carriers`, or `message_carriers`.

Chat mutations also publish TinyOffice-owned realtime notifications through the current socket.io realtime gateway at `/api/realtime/socket.io`. The event protocol is defined in `src/collaboration/contracts/tinyoffice-realtime-contract.ts` and covers Chat entry/message/read/projection notifications plus runtime status, process-trace, and active reply streaming events. Chat realtime viewer and runtime target fields are member-only: `viewerMemberId`, `memberId`, and `targetMemberId`. Mattermost post hooks, plugin WebSocket behavior, native frontend events, Team/User/Channel/Post ids, and port `8065` are not the product realtime surface.

## Chat Runtime UI State

The standalone Chat UI treats employee runtime execution as a room-scoped state machine, not as ad hoc message rows.

Runtime status events create local run state for the selected room as soon as a run is queued, received, thinking, tool-calling, streaming, cancel-requested, failed, or canceled. The right Context panel shows Activity only from backend-projected Process Trace evidence. Before the first visible assistant reply event for a run, the runtime must publish a persisted `ProcessTraceEvent` for that run, normally `employee_reply_started`, so the Context panel has real Activity evidence before `chat.reply.delta` or `chat.reply.snapshot` reaches the message stream.

Chat attachment content inherits Chat visibility. An uploaded attachment with no Message reference is readable only by its uploader so the composer can preview it before sending. Once referenced by one or more Messages, it is readable only by a member who participates in at least one referencing Conversation. Unauthorized reads return the same not-found response as a missing attachment so the endpoint does not disclose private attachment existence. The API reuses current-member session identity, `chat_attachment_references`, and the Conversation participant authorization boundary; attachment ids are not bearer credentials.

Visible assistant text streams into the message stream only as a draft reply while the backend run is active. Once a reply is persisted, the message stream should show the persisted Chat message. If a run is canceled before a reply is persisted, the message stream must not keep a stopped partial draft as if it were a Chat message; the cancellation belongs in Process Trace/runtime evidence. If a run fails before a reply is persisted, the frontend may show a user-facing failure draft while the Process Trace records the technical failure.

The runtime dispatch must publish enough realtime and persisted metadata for the backend Activity projection to correlate Process Trace evidence with the current room: `companyId`, `conversationId`, `sourceMessageId`, `replyMessageId` when available, `targetMemberId`, and `runId`. Product surfaces must never display a member id as a display-name fallback.

Chat runtime state-machine acceptance:

| State | Required backend event | UI contract |
| --- | --- | --- |
| Run accepted | `chat.runtime_status.changed` with `queued` / `received` | Composer may switch to Stop; message stream does not show a fake assistant row. |
| Work begins | `chat.runtime_status.changed` with `thinking`, followed by a persisted `chat.process_trace.appended` for the same `runId` | Context Activity dock shows real active evidence before visible assistant text starts. |
| Text streams | `chat.reply.delta` / `chat.reply.snapshot` | Message stream shows one draft reply for the `runId`; Context keeps the Activity dock stable. |
| Reply persists | `chat.message.created` and `chat.runtime_status.changed` with `completed` | Draft reply is replaced by the persisted Chat message. |
| Run fails | `chat.runtime_status.changed` with `failed` plus `chat.process_trace.appended` failure evidence | Message stream may show concise failure state; technical details stay in Activity raw evidence / Sessions. |
| Run cancellation requested | `chat.runtime_status.changed` with `cancel_requested` | UI may show cancellation as pending, but must not synthesize a terminal canceled state. |
| Run cancels | `chat.runtime_status.changed` with `canceled` plus cancellation trace evidence when available | No stopped partial draft is promoted to a Chat message. |

Chat runtime breakpoint audit:

| Scenario | Contract |
| --- | --- |
| Existing DM reply | The message mutation persists the user's message, dispatches exactly one runtime-capable DM peer, publishes active runtime status for that room, publishes Process Trace evidence before any visible reply delta/snapshot, streams one draft reply, then replaces it with the persisted assistant message on completion. |
| Create DM topic | The create-entry mutation returns a concrete `dm_session_entry` and seeds the local projection cache before refetch. The shell must stay on the created entry room and must not flash to the generic `Entries` fallback while runtime work starts. |
| Create channel topic | The create-entry mutation returns a concrete `channel_topic`, seeds the local projection cache, and starts from the created topic room. Channel containers remain directories; they do not become reply timelines. |
| Channel mention dispatch | Runtime dispatch only routes to explicitly mentioned runtime-capable channel participants. The runtime context exposes handoff candidates excluding the actor, and target ids are member ids. |
| Channel handoff | The current actor's visible reply must be persisted before a handoff child run starts. The child run gets its own `runId`, `sourceMessageId`, `targetMemberId`, status stream, and Process Trace activity. |
| Stop/cancel | Stop calls the backend cancel endpoint for the active `runId`. `cancel_requested` keeps the run active and pending; only backend `canceled` makes the run terminal. A canceled partial draft is never promoted to a Chat message. |
| Failure before reply persistence | The backend publishes `failed` runtime status and failure Process Trace evidence, persists no assistant reply, and the frontend may show only a concise failure draft. Technical error details belong in Activity raw evidence / Sessions. |
| Activity display | Concrete entry rooms show an Activity dock projected by the backend. Directory/list surfaces do not show active trace UI. Raw Process Trace events are available by expanding Activity rows. |
| Display name transition | Runtime drafts, persisted messages, Context participants, and Activity labels must resolve member display names from session, channel membership, directory, or DM contact truth. Product UI must not display member ids as fallback names. |
| Module alerts | Container and entry unread/mention counts are projection state. The Chat rail indicator shows that Chat has unseen conversation activity; sidebar and topic-row badges identify the concrete source. There is no separate Attention projection. |

When a create-entry mutation returns, the frontend may seed the returned `container` and `entry` into its local projection cache before refetching. This prevents the shell from flashing back to an unknown `Entries` fallback while the backend projection refresh catches up. The backend projection remains the source of truth after refetch.

The projection validates every outgoing container and entry with the Chat Entry boundary guard. Public payloads must not contain Mattermost carrier field names such as `teamId`, `team_id`, `channelId`, `channel_id`, `postId`, `post_id`, `rootPostId`, `root_id`, `userId`, or `user_id`.

## Consumer Expectations

Standalone Chat clients should read this projection instead of deriving Chat containers or entries from raw Conversation, Message, ChannelTopic, Session, WorkRun, ProcessTrace, SessionEvent, Attachment, or Mattermost carrier data.

Consumers should:

- render `containers` as directories only
- open only `entries`
- use `entry.openTarget` to request the concrete room/message surface
- use `/chat/rooms/:roomId`, `/chat/rooms/:roomId/messages`, `/chat/rooms/:roomId/read`, and `/chat/rooms/:roomId/title` to read, reply, update read state, and manually rename an opened entry
- display runtime links only as evidence/context links
- treat `titleStatus` and `titleSourceMessageId` as backend-owned title state, not as fields the frontend computes or model-calls directly

Consumers should not:

- infer a reply timeline from a `ChatContainerDto`
- treat Session, WorkRun, ProcessTrace, SessionEvent, or Attachment ids as Chat identity
- represent a DM Session Entry as a Channel Topic
- depend on Mattermost Team, User, Channel, Post, root post, or native route ids

## Carrier Guard

Public Chat Entry DTOs must never expose Mattermost carrier ids or carrier discovery vocabulary. Forbidden public field names include:

- `team_id`, `teamId`, `carrierTeamId`
- `channel_id`, `channelId`, `carrierChannelId`
- `post_id`, `postId`, `carrierPostId`
- `root_id`, `rootPostId`, `carrierRootPostId`
- `user_id`, `userId`, `providerUserId`, `carrierUserId`

Carrier metadata must not be returned through this contract.

## Create Entry API

`POST /api/companies/:companyId/chat/entries` creates a concrete entry/open target. The request must carry explicit TinyOffice context:

```ts
interface ChatCreateEntryRequest {
  companyId: string;
  containerId: string;
  actorMemberId: string;
  title?: string;
  firstMessage: {
    body: string;
    attachmentIds?: string[];
    mentionedMemberIds?: string[];
    runtimeLinks?: Array<{
      linkId?: string;
      targetKind: "session" | "work_run" | "process_trace" | "session_event";
      targetId: string;
      label?: string;
      createdAt?: string;
    }>;
  };
}
```

The path `companyId` and body `companyId` must match. Requests and responses reject public carrier fields such as `channelId`, `postId`, `teamId`, or `userId`.

Supported containers in this slice:

- `chat-container-channel-{chatChannelId}` must refer to a formal Channel visible to the actor. Creating from it writes a `channel_topic` entry backed by a `conversationKind: "topic"` Conversation whose topic state carries the owning `chatChannelId`. If the caller sends an explicit `title`, it is used as a manual title. If no explicit title is sent, the backend derives the initial title from `firstMessage.body` and marks it as backend-generated unless System AI title refinement is configured. Topic participants are derived from Channel membership; ad hoc participant selector lists cannot invent visibility outside the Channel.
- `chat-container-member-dm-{memberId}` creates a `dm_session_entry` backed by a `conversationKind: "direct"` Conversation between the actor member and the peer member encoded by the container id. It does not create a Channel Topic and does not use topic identity.

Channel membership is member-only. A Channel participant row carries `member_id`; old `employee_id` Channel membership storage is not part of the current pre-release PostgreSQL baseline. Channel topic creation projects those rows into company-member Conversation participants without guessing or aliasing.

Runtime context must not collapse Channel handoff candidates into a bare id list. The backend supplies handoff candidates with display name, stable id, and product role/responsibility where available, excluding the member taking the current turn. Channel membership is only the visible participant list; it does not carry a separate owner/member/guest role system. Runtime routing may still need internal execution capability checks, but prompt context must not present those checks as human-vs-AI collaboration categories.

The production path writes through the TinyOffice-owned Conversation/Message service and repository boundary. It creates the Conversation and first Message in one repository transaction, updates `conversations.last_message_id`, then reads the Chat Projection to return the created DTO. This keeps create success tied to persisted PostgreSQL-backed Conversation/Message truth instead of an in-memory Chat-only result or legacy Mattermost carrier state. If the first-message write fails, the Conversation write rolls back rather than leaving a topic room without its opening Message.

When System AI title generation is not configured, create-entry still succeeds. The backend derives a deterministic initial title from `firstMessage.body`, stores it on the Conversation, and projects it as the Chat Entry title. Missing System AI configuration must not make topic creation fail and must not push title generation into the frontend.

When System AI title generation is configured, create-entry stores the returned entry with a provisional title and `titleStatus: "placeholder"`, then submits a backend-owned title-generation request after the first message has been persisted. The request evidence is explicit: `companyId`, Chat `entryId`, backing room/conversation id, source `messageId`, source body, and actor member context. The request is not a Chat participant, not an employee runtime session, not a WorkRun, and not a frontend model call.

The System AI provider/config/audit boundary lives under `src/system-ai/`. `provider-config.ts` defines the explicit provider configuration contract, provider kind, enabled/disabled state, config/model references, config version, and source-backed audit event shape. `chat-title-generation.ts` and `chat-topic-summary-generation.ts` consume that boundary through explicit provider registries: missing or disabled config fails closed instead of falling back to a hidden company/global provider. `postgres-system-ai-repository.ts` persists company-scoped provider config and audit events in PostgreSQL. `pi-chat-title-generation-provider.ts` is the real PI-backed provider for title generation; `pi-chat-topic-summary-generation-provider.ts` is the real PI-backed provider for Topic summary refresh; each provider uses the configured `modelRef` from the same PI model registry used by employee runtime model selection. Deterministic providers are only local/test `test_deterministic` providers behind this boundary.

Company creation exposes a separate System AI model selector. When selected, the Company Blueprint seeds explicit `pi_model` provider config rows for both `chat_title_generation` and `chat_topic_summary` using the selected `provider/model` reference. This selector is intentionally separate from the first HR runtime model because System AI title and summary work can have different model requirements from the HR employee. After Company creation, the Company page exposes System AI Settings so operators can configure Chat title generation and Topic summaries independently without using the employee runtime configuration surface.

Title generation records `requested`, `generated`, and `failed` System AI audit events with `companyId`, capability, request id, Chat entry source, source Message evidence, provider/config reference when available, status, error reason, and timestamps. The audit event is separate from Chat messages; it does not create fake Chat messages and does not make System AI an employee, runtime Session, or WorkRun. The PI provider must not add Pi/OpenAI/Codex-specific fields to Chat DTOs; provider details stay in System AI config/audit records. Failure records `titleStatus: "failed"`, `titleSourceMessageId`, and an internal failure reason on the Conversation state while preserving the existing provisional title. If a user has already manually renamed the room, a pending generated or failed System AI title result must not overwrite the `manual` title.

Topic summary generation is a separate System AI capability, `chat_topic_summary`, and must not reuse or masquerade as the `chat_title_generation` capability. Runtime Dispatch requests a refresh only after a Channel/Topic employee reply has been persisted and the topic has enough recent messages to justify compression. The request source is the Conversation Topic, not a Chat entry title: audit source `objectKind` is `conversation_topic`, `objectId` is the `topicId`, and evidence contains the bounded recent message ids/bodies used for summarization. A generated summary is written to `Conversation.topic.summary` through `MessageService.updateConversationTopicSummary`; failures record System AI audit evidence and do not write placeholder or frontend-generated summary text.

## Manual Title Editing

`PATCH /api/companies/:companyId/chat/rooms/:roomId/title` is the room-title mutation for explicit user edits. The request body must carry the same `companyId`, an explicit actor selector, and a non-empty `title`:

```ts
interface ChatUpdateRoomTitleRequest {
  companyId: string;
  actorMemberId: string;
  title: string;
}
```

The route writes through `MessageService.updateConversationTitle`, sets `titleStatus: "manual"`, clears generated-title source/failure metadata, syncs the backing topic title when present, and publishes `chat.projection.changed` for visible participants. It does not create Chat messages, System AI audit events, runtime Sessions, WorkRuns, or Process Traces.

Manual titles are highest priority. Once a Conversation title is `manual`, asynchronous System AI title generation may not overwrite it unless a future explicit "regenerate title" product action is added.

The frontend must treat manual title editing as a backend mutation. It must not hide bad persisted titles with prefix stripping, display-only cleanup, local title caches, or title-generation calls from the browser.

## Topic Archive

`POST /api/companies/:companyId/chat/rooms/:roomId/archive` is the active-list removal action for concrete topic rooms. The request body must carry the same `companyId`, an explicit actor selector, and the confirmation string `ARCHIVE`:

```ts
interface ChatArchiveRoomRequest {
  companyId: string;
  actorMemberId: string;
  confirmation: "ARCHIVE";
}
```

The route verifies the actor can access the room, writes through `MessageService.archiveConversationTopic`, sets `Conversation.topic.status` to `archived`, and publishes `chat.projection.changed` for visible company-member participants. The active projection filters archived topics before returning entry lists, so an archived topic disappears from Channel/DM lists without deleting its messages or runtime evidence.

`POST /api/companies/:companyId/chat/rooms/:roomId/restore` is the matching recovery action. Its request body uses the same shape with confirmation `RESTORE`. The route verifies the actor can access the room, writes through `MessageService.restoreConversationTopic`, sets `Conversation.topic.status` to `open`, and publishes `chat.projection.changed` for visible company-member participants.

The standalone frontend must show an explicit confirmation affordance before calling the archive API. The current Chat list uses an inline second-click confirmation rather than a modal. The archived topic does not stay in the active list with a muted badge. Topic archive and restore are operator UI actions, not AI-callable capabilities.

## Frontend Title Flow

Standalone Chat create-entry and room-reply mutations use the TinyOffice MessageService path. They require only valid TinyOffice company, member, participant, Conversation, and Message state.

The standalone frontend runtime path uses this API from Channel and Direct Message container starters. It posts the create-entry command with explicit company and actor selector context plus `firstMessage.body`; when the user selected `@` mentions in a Channel or Topic composer, it also sends `firstMessage.mentionedMemberIds`, and when the user attached images it sends only uploaded `firstMessage.attachmentIds`. It must not compute or send a default title unless the user explicitly provided one. The backend owns default title generation from the first message, and the frontend displays the projected `entry.title` without trimming, prefix removal, or other title cleanup. After create-entry returns, the frontend refreshes Chat Projection and selects the returned `entry.openTarget.roomId` as the newly opened room. Without an initialized runtime Company context, the frontend must fail explicitly instead of showing or mutating fixture Chat data.

The shadcn Chat frontend starts new entries through a frontend-only draft surface. A Channel or Direct Message entry list shows an explicit `Start new topic` action, then opens a draft message stream such as `New topic with Iris` or `New topic with Growth Ops`. This draft surface has no `entryId`, no `roomId`, and no persisted backend object. If the user leaves the draft before sending the first message, the draft is discarded. Only submitting the first message calls `POST /api/companies/:companyId/chat/entries`, after which the frontend opens the returned persisted entry room and the backend-owned title flow runs.

The shadcn Chat frontend treats `@` as an explicit structured mention selector, not as a text parser. Channel and Topic composers open an inline shadcn `Popover` + `Command` suggestion surface when the user types `@`, showing visible runtime-capable participants as mention candidates. Selecting a candidate inserts the display label into the composer and returns focus to the composer. Sending a message preserves the display text in `body` and sends the selected member ids in `mentionedMemberIds`. The frontend must not wake employees by scanning arbitrary message text for display names.

The response is:

```ts
interface ChatCreateEntryResponse {
  schema: "chat-create-entry-result";
  version: 1;
  companyId: string;
  container: ChatContainerDto;
  entry: ChatEntryDto;
  openTarget: ChatOpenTargetDto;
  firstMessageId: string;
}
```

`container`, `entry`, and `openTarget` are projection-shaped Chat DTOs. `firstMessageId` is a TinyOffice Message id that anchors the initial room message. Mattermost Team, Channel, User, Post, or root-post ids are not public API identity.

## Non-Goals

This Chat Entry slice does not implement:

- Access Request foreground cards
- Mattermost plugin routing
- provider-specific title fields
- automatic runtime replies, PI dispatch, or runtime session / Process Trace generation expansion
- non-image attachment upload, object-store replacement, parsing/OCR/PDF extraction, scanning policy, per-mention mixed-model upload guidance, and broad file-governance UI
- Channel/Topic context-mode switching controls
- multi-user login, invitation, and delegation; single-Owner passkey authentication is the current product boundary

The #499/System AI foundation can now populate `title`, `titleStatus`, and `titleSourceMessageId` through the backend-owned title-generation boundary, with explicit provider config and source-backed audit events. The preview runtime wires this boundary to the PI-backed `pi_model` provider and drains title generation asynchronously after create-entry, so the create-entry response is not blocked by title refinement.

Explicit follow-ups:

- decide title-generation retry/regenerate UI separately

## Verification

Run:

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/collaboration/chat-entry-contract.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/collaboration/chat-create-entry-service.test.ts tests/collaboration/chat-projection-service.test.ts tests/collaboration/chat-projection-api-routes.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/conversation-api-runtime.test.ts
node --import tsx --test apps\tinyoffice-web-shadcn\src\api\chatClient.test.ts apps\tinyoffice-web-shadcn\src\chat\chatShellModel.test.ts tests\frontend\shadcn-frontend-foundation.test.ts
```

The guard tests verify:

- public Chat Entry DTO key sets use TinyOffice vocabulary
- container kinds remain distinct from entry kinds
- Channel Topic and DM Session Entry open different target kinds
- DM Session Entry cannot masquerade as a Channel Topic open target
- carrier ids are rejected
- runtime evidence ids stay out of DTO identity fields
- backend System AI title generation can enqueue after create-entry without blocking the response
- System AI provider config rejects hidden fallback and supports explicit enabled/disabled state
- System AI provider config supports PI model-backed title generation selection
- PostgreSQL System AI repositories persist provider config and source-backed audit events
- PI title provider uses the selected PI model with no tools and a title-only prompt
- System AI title generation records requested/generated/failed audit events with Chat source evidence
- deterministic title generation updates `titleStatus: "generated"` and `titleSourceMessageId`
- provider failure updates `titleStatus: "failed"` without fake Chat messages
- manual title editing persists `titleStatus: "manual"` through the room title API
- pending generated or failed System AI title results cannot overwrite a manual title
- channel containers list channel topic entries
- Direct Message containers list DM session entries
- DM session entries are not represented as channel topics
- container payloads do not expose message timelines as reply rooms
- runtime links remain evidence/context only
- public projection payloads reject carrier field vocabulary
- create-entry writes Channel Topic and DM Session Entry objects through the Conversation/Message boundary
- created entries are visible through the backend Chat Projection
- create-entry requests reject missing explicit context and public carrier field vocabulary
- Chat room read, reply, and read-state endpoints use `openTarget.roomId` / Conversation ids without requiring Mattermost carrier rows
- Chat mutations publish owned WebSocket realtime events with TinyOffice ids only

# Conversation / Message Contract

This page defines the TinyOffice-owned Conversation and Message contract. It now includes the #474 backend Conversation State slice for Work Memory: topic room state, participant read/mention projection, attachment metadata, runtime evidence links, and the persisted realtime sequence boundary.

For the standalone Chat frontend directory/open-target model, use the [Chat Entry Contract](chat-entry-contract.md). That contract separates Channel and Direct Message containers from concrete Channel Topic and DM Session Entry open targets.

## Product Meanings

| Term | Meaning |
| --- | --- |
| Conversation | A TinyOffice-owned collaboration record inside exactly one Company. Current runtime dispatch supports direct member conversations and topic-backed collaboration streams. Unsupported kinds must fail closed instead of being silently mapped into another prompt mode. |
| Message | A user-visible item inside one Conversation. A Message belongs to exactly one Company and one Conversation. |
| Participant | A TinyOffice company member in a Conversation. Participants are identified by TinyOffice `participantId` and `memberId`; runtime employee ids stay in runtime/session evidence, not Conversation collaboration identity. |
| ParticipantState | TinyOffice's per-participant read/unread/mention projection for one Conversation. This is product state, not a carrier unread counter. |
| Attachment | A TinyOffice attachment record linked to one Message. The public contract exposes `attachmentId` and display/download metadata only. |
| RuntimeLink | A TinyOffice evidence anchor from a Conversation or Message to a Session, WorkRun, ProcessTrace, or SessionEvent. A RuntimeLink is evidence; it does not make the chat thread equal the runtime Session. |
| RealtimeEvent | A versioned event envelope that lets clients incrementally update Conversation, Participant, Message, and Attachment state. |

TinyOffice product clients consume Company, Member/Participant, Conversation, Message, Attachment, and RealtimeEvent truth. Retired carrier behavior is not part of the current backend foundation.

## Public DTO Contract

The source contract is `src/collaboration/contracts/conversation-message-contract.ts`.

All public DTOs carry:

- `schema`
- `version`
- explicit `companyId`
- TinyOffice-owned resource ids such as `conversationId`, `messageId`, `participantId`, `memberId`, and `attachmentId`

Public Conversation DTO:

| Field | Meaning |
| --- | --- |
| `companyId` | Tenant boundary for the Conversation. |
| `conversationId` | TinyOffice-owned Conversation id. |
| `title` | Client display title. |
| `conversationKind` | Product-level kind. Current runtime dispatch supports `direct` and `topic`; unsupported kinds are not prompt-compatible by default. |
| `topic` | Optional TinyOffice topic-room state for the current thread-as-room model: `topicId`, status, owner participant, participant ids, and optional System AI-maintained topic summary. |
| `participants` | TinyOffice participant DTOs. |
| `participantStates` | Per-participant read/unread/mention projection. |
| `lastMessageId` | Optional TinyOffice id for the most recent known Message. |
| `runtimeLinks` | Conversation-level runtime evidence anchors. |
| `realtimeSequence` | Persisted sequence used by realtime event consumers for this Conversation. |
| `createdAt`, `updatedAt` | ISO timestamps from TinyOffice truth. |

Public Message DTO:

| Field | Meaning |
| --- | --- |
| `companyId` | Tenant boundary for the Message. |
| `conversationId` | Parent TinyOffice Conversation id. |
| `messageId` | TinyOffice-owned Message id. |
| `sender` | TinyOffice sender display object; uses `participantId` plus `memberId`. Product UI should present sender name/role, not internal ids. |
| `body` | Plain user-visible message body for this contract slice. |
| `mentions` | Explicit TinyOffice mention records for participants mentioned by the Message. |
| `attachments` | TinyOffice attachment DTOs. |
| `runtimeLinks` | Message-level runtime evidence anchors. |
| `createdAt`, `updatedAt` | ISO timestamps from TinyOffice truth. |
| `deliveryState` | `pending`, `sent`, `failed`, or `deleted`. |

Public DTOs must never expose carrier ids or carrier discovery vocabulary. Forbidden public field names include `team_id`, `teamId`, `user_id`, `userId`, `channel_id`, `channelId`, `post_id`, `postId`, `root_id`, and `rootPostId`.

Attachment DTOs carry TinyOffice metadata only: file name, MIME type, byte length, optional TinyOffice download/preview URLs, optional storage key, optional content hash, and optional metadata. They do not expose carrier file ids or local filesystem paths.

Chat v1 supports image attachments for `image/png`, `image/jpeg`, and `image/webp`. Browser clients upload an image through the Chat attachment route, receive a public attachment DTO, and then send only `attachmentIds` with the Message or create-entry first message. The Message service resolves those ids into immutable Message attachment snapshots. Browser-supplied inline attachment metadata is rejected by the product API so clients cannot forge file records or local paths. Runtime visual understanding is controlled by the target employee model's declared image input capability. General files, GIFs, parsing/OCR/PDF extraction, scanning policy, and richer file-governance UI remain follow-up slices.

## Company Boundary

Every read and write requires explicit `companyId`.

Rules:

- Missing, empty, or whitespace-only `companyId` fails with a clear contract error.
- A resource already loaded for a different Company fails as a mismatch.
- Backend code must not fall back to a default Company, bootstrap Company, global Company, legacy Company alias, or old test-data compatibility path.
- Standalone frontend calls must pass `companyId` obtained from TinyOffice Company context, not from carrier-native discovery.

The helper `ensureConversationCompanyScope` expresses this contract boundary. Service entrypoints should use the same rule before touching storage.

## Internal Service Boundary

The contract defines the service boundary implemented by the backend slice:

```ts
interface ConversationMessageService {
  createConversation(input: CreateConversationInput): Promise<ConversationDto>;
  listConversations(input: ConversationServicePageInput): Promise<ConversationPage>;
  getConversation(input: ConversationLookupInput): Promise<ConversationDto | undefined>;
  listMessages(input: MessageListInput): Promise<MessagePage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  markConversationRead(input: ConversationReadStateInput): Promise<MarkConversationReadResult>;
}
```

Inputs require `companyId` plus the relevant TinyOffice ids. Conversation and Message collaboration identity is member-only: create participants with `memberId`, list with `viewerMemberId`, send with `actorMemberId`, and read with `viewerMemberId`. Old employee selector aliases fail explicitly. Message mentions in Chat-owned send/create-entry paths use `mentionedMemberIds`.

Backend behavior lives in `src/collaboration/message/message-service.ts`. Persistence lives behind `MessageRepository` and `PostgresMessageRepository` in `src/collaboration/message/`. The mainline service path writes TinyOffice Conversation and Message truth without requiring Mattermost projection or carrier ids. Chat-owned create-entry and room-reply mutations run their Conversation/Message state changes inside the repository transaction boundary so `lastMessageId`, participant state, realtime sequence, and inserted Messages cannot diverge on a failed write.

Topic runtime context uses `MessageService.listRecentMessages` for model handoff windows. This method selects the newest persisted messages first and returns that bounded window in chronological order for Topic prompt assembly. Runtime Dispatch stores the last rendered Topic message cursor as structured prompt-context evidence on the runtime Session. The next turn for the same persistent `sessionKey` filters the bounded window to messages after that cursor instead of resending the whole raw window. Direct Message runtime input does not render this raw-message window into prompt context; it sends the current message as the turn input and relies on the persistent provider session for earlier DM continuity. `listMessages` remains the room-history API for frontend reads. Topic summaries live in `Conversation.topic.summary`; they are backend-owned context state and must not be synthesized by the frontend, Session trace renderer, or legacy ChannelTopic storage. `MessageService.updateConversationTopicSummary` is the write boundary for System AI topic summaries and hard-errors when the target Conversation is not a topic conversation.

PostgreSQL remains the unified product truth. The Conversation State slice uses the existing runtime database and extends the existing tables:

| Table | Product state |
| --- | --- |
| `conversations` | Conversation identity, topic state JSON, participant state JSON, runtime link JSON, last message id, and realtime sequence. |
| `conversation_messages` | Message identity/body/sender, attachment JSON, mention JSON, runtime link JSON, and delivery state. |
| `conversation_participants` | Queryable participant membership projection. |

The old `conversation_carriers`, `message_carriers`, and `employee_account_links` tables are not part of current product storage or the current pre-release PostgreSQL baseline.

`conversation_participants` stores a queryable `member_id` projection. The canonical participant and sender DTOs are still stored in the Conversation/Message JSON shapes.

Public DTOs, Chat room APIs, Chat Projection APIs, runtime dispatch payloads, and standalone frontend view models must stay free of Mattermost Team/User/Channel/Post identity.

## Standalone Frontend API Boundary

The standalone frontend consumes Conversation/Message truth only through the Chat API facade. The older public `/api/companies/:companyId/conversations...` route family is retired; `MessageService`, message repositories, and Conversation DTOs remain internal foundations for Chat, runtime dispatch, and realtime publication.

The Chat Entry API also exposes the same MessageService-backed room surface through `openTarget.roomId`:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/companies/:companyId/chat/rooms/:roomId` | Read the Conversation DTO backing a Chat room. |
| `GET` | `/api/companies/:companyId/chat/rooms/:roomId/messages` | List Message DTOs for the opened Chat room. |
| `POST` | `/api/companies/:companyId/chat/rooms/:roomId/messages` | Append a Message reply as an explicit TinyOffice actor selector. |
| `POST` | `/api/companies/:companyId/chat/rooms/:roomId/read` | Mark the opened Chat room read for an explicit viewer selector. |
| `POST` | `/api/companies/:companyId/chat/attachments` | Upload a company-scoped Chat image attachment and return the public attachment DTO. |
| `GET` | `/api/companies/:companyId/chat/attachments/:attachmentId/content` | Serve the stored image bytes for preview or download. |

`roomId` is the Chat `openTarget.roomId`, currently the TinyOffice-owned `conversationId` projected by `ChatProjectionService`. This is a Chat façade over the same Conversation/Message truth, not a Mattermost carrier history/send route.

The Hono TinyOffice API enforces authentication before exposing this surface. Every request resolves viewer and actor identity from the verified Owner session; query parameters, headers, and request bodies cannot select another current user. Projection entries are filtered by the Owner member's participant access to each target room. Direct room reads, message reads, sends, and read-state updates load the backing Conversation and require that member to match a participant by `participantId` or `memberId` before messages are returned or mutations run. Runtime context assembly uses the same participant rule before preparing a runtime-capable member turn.

POST request bodies also carry `companyId`; Chat routes validate that body context against the Company route parameter before calling `MessageService`. Chat send bodies accept `actorMemberId`; read bodies accept `viewerMemberId` or `memberId`; Chat mentions use `mentionedMemberIds`; Chat attachment uploads use the current member owner. Old Chat fields including `actorEmployeeId`, `viewerEmployeeId`, `participantEmployeeIds`, `mentionedEmployeeIds`, and `ownerEmployeeId` fail explicitly. Message send bodies and create-entry `firstMessage` bodies may carry `attachmentIds`; they must not carry inline `attachments` metadata. The standalone frontend must treat these API routes as the product boundary. It should not depend on Mattermost team, user, channel, or post identifiers.

Conversation/Message write responses still return Conversation realtime event envelopes for local state updates. The Chat product realtime stream is now a TinyOffice-owned socket.io protocol defined in `src/collaboration/contracts/tinyoffice-realtime-contract.ts` and served by `src/runtime/realtime/tinyoffice-realtime-gateway.ts`; Chat create/reply/read mutations publish `chat.entry.created`, `chat.message.created`, `chat.read_state.updated`, and `chat.projection.changed` notifications with TinyOffice ids only. Realtime read/projection events target `memberId` / `viewerMemberId`; runtime status, process trace append, reply delta, and reply snapshot events target `targetMemberId`.

This route slice does not add `/events`, SSE, Mattermost native webapp entrypoints, Mattermost plugin shell routes, `registry.registerRootComponent`, or port `8065` as product frontend requirements. Mattermost post hooks, plugin websocket behavior, and native frontend events must not be proxied as the public Conversation/Message or Chat realtime contract.

## Carrier Metadata

Carrier metadata is not part of the public contract.

Allowed internal shape:

- `provider`
- `internalConversationRef`
- `internalMessageRef`
- `internalParticipantRefs`

This internal shape is intentionally separate from public DTOs and must not be returned to product clients.

## Realtime Event Model

The realtime boundary is a TinyOffice contract before it is a transport. Public events are frontend-consumable product DTOs emitted by TinyOffice-owned API/service code.

The minimal realtime envelope is:

| Field | Meaning |
| --- | --- |
| `schema` | `conversation-message-realtime-event`. |
| `version` | Contract version. |
| `eventId` | TinyOffice realtime event id. |
| `type` | `conversation.created`, `conversation.updated`, `participant.joined`, `participant.left`, `message.created`, `message.updated`, `message.deleted`, or `attachment.added`. |
| `occurredAt` | ISO timestamp. |
| `sequence` | Monotonic positive sequence number for this Company + Conversation event stream. The first emitted event for a persisted Conversation uses `1`; each later Conversation state event increments from the stored `Conversation.realtimeSequence`. |
| `companyId` | Explicit Company boundary. |
| `conversationId` | Affected TinyOffice Conversation id. |
| `messageId` | Optional affected TinyOffice Message id. |
| `actorMemberId` | Optional TinyOffice company member actor id. |
| `payload` | Event-specific product payload. |

The event type set also includes `participant.read_state.updated`, `participant.mention_state.updated`, and `conversation.runtime_link.added` for the backend Conversation State slice. The sequence is persisted on the Conversation record so later API/realtime work can resume from TinyOffice state instead of carrier-native state.

Public event shape rules:

- every event carries explicit `companyId` and `conversationId`
- every event carries stable `eventId` and positive integer `sequence`
- `messageId` is included only when the event is about one TinyOffice Message
- `actorMemberId` is included when a TinyOffice company member actor caused the event
- payload fields use TinyOffice product ids such as `participantId`, `memberId`, `messageId`, `attachmentId`, `runtimeLinks`, and delivery/read state
- payloads and envelopes must not expose carrier ids or carrier vocabulary such as `team_id`, `teamId`, `carrierTeamId`, `user_id`, `userId`, `providerUserId`, `channel_id`, `channelId`, `carrierChannelId`, `post_id`, `postId`, `carrierPostId`, `root_id`, `rootPostId`, or `carrierRootPostId`

This slice intentionally does not define a transport subscription endpoint, reconnect protocol, replay cursor API, browser UI, native Mattermost frontend shell, or plugin-root rendering behavior. The current HTTP write responses return event envelopes as the contract seed; a later transport can carry the same envelopes without changing standalone frontend state semantics.

## Runtime Evidence Boundary

Runtime links are references to runtime evidence, not ownership transfers:

- `session` points to a TinyOffice Session record.
- `work_run` points to a WorkRun.
- `process_trace` points to a Process Trace anchor.
- `session_event` points to a Session event anchor.

A Conversation can contain multiple RuntimeLinks, and a RuntimeLink can be attached to a Message. This keeps the current thread-as-room interaction model connected to Work Memory evidence without treating a chat thread, Topic, Session, WorkRun, or trace as the same object.

## Guard Tests

The guard test is `tests/collaboration/conversation-message-contract.test.ts`.

It verifies:

- public DTO key sets contain TinyOffice ids only
- forbidden carrier field names are not exposed by public DTO key sets
- company scope rejects missing and mismatched Company context
- realtime events expose stable TinyOffice identifiers, reject invalid sequences, and guard payloads against carrier id leakage
- topic/read/mention/runtime-link shapes stay in TinyOffice-owned public DTOs

Backend persistence and projection tests live in:

- `tests/collaboration/message-service.test.ts`
- `tests/collaboration/postgres-message-repository.test.ts`
- `tests/runtime/postgres-schema.test.ts`

Run:

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/collaboration/conversation-message-contract.test.ts
```

# Chat

TinyOffice Chat is the main collaboration surface for a company workspace. It is owned by the TinyOffice frontend and backend APIs.

## Product Model

Chat has three visible conversation shapes:

| Shape | Meaning |
| --- | --- |
| DM | A one-to-one member space. It can be opened from the DMs list and can start a persisted chat with a runtime-capable member. |
| Channel | A formal multi-member collaboration space owned by TinyOffice. A Channel must have persisted membership and role/permission state; the product must not present a Channel that only exists as a temporary topic bucket. |
| Topic | A specific discussion or work item inside a Channel. Opening a Topic shows the concrete conversation and message history. Topic visibility inherits Channel participants unless a later product decision introduces narrower Topic visibility. |

Implementation uses internal DTO names for projection and open targets, but the product UI should not expose those names. "Entry" is an internal openable conversation/session record, not product wording.

## Execution Boundary

Chat frontend code must use TinyOffice-owned APIs:

- workspace directory and visible conversations: `GET /api/companies/:companyId/chat`
- open conversation and message history: `GET /api/companies/:companyId/chat/rooms/:roomId` and `/messages`
- send a message: `POST /api/companies/:companyId/chat/rooms/:roomId/messages`
- create/read/update Channel membership and Channel Topics: TinyOffice-owned Chat Channel APIs plus `POST /api/companies/:companyId/chat/entries`
- realtime refresh: TinyOffice realtime events

The frontend must not call employee runtimes directly. Employee execution, replies, context lookup, Channel/Topic creation, permissions, Session, Process Trace, and realtime events stay behind backend APIs/services and Runtime Dispatch.

TinyOffice-owned Chat uses the model's assistant reply as the visible Chat message. Chat does not accept a separate final-tool `message` payload as the message source.

- DM turns produce a normal assistant reply. That reply becomes the visible TinyOffice Conversation message.
- Channel/Topic turns also produce a normal assistant reply. In addition, the model must call `handoff_topic_turn` with `toId` so Runtime Dispatch knows which participant owns the next step.
- `handoff_topic_turn` carries state only. It must not contain a visible reply `message` field.
- Ordinary Channel/Topic messages do not wake every employee. They route only by explicit employee mention or by the structured `handoff_topic_turn.toId` handoff from a prior employee turn.
- A product member actor can wake a runtime-capable DM peer or explicitly mentioned employee while remaining a member actor. Runtime Dispatch must not silently map that member actor into an employee or pick a default employee.
- Runtime failure records Session and Process Trace evidence and must not create a fake successful Chat reply.

Chat write-back uses Conversation, Message, Runtime Session, and Process Trace evidence.

## First Version UI

The first productized Chat experience shows:

- left workspace navigation with Channels and DMs. Channels and DMs are top-level objects; Topic rows and DM chat entries are not flattened into the normal left navigation.
- middle room shell for a Channel overview, member overview, Topic conversation, or DM chat. Channel overview shows the Topic directory, member overview shows the Chat directory, and concrete rooms show compact room header, independent message scroll, and a composer pinned to the bottom of the room.
- right Context rail with real data only for the selected Chat surface. A DM member page shows the selected member profile/runtime state and no Participants list. A DM chat entry shows the counterpart, current chat status, WorkRun entry points, a stable Activity dock, and Files reserved slot. A Channel shows Channel summary, Participants with Company/profile responsibility role badges, and Topic count. A Topic shows Topic summary, parent Channel, visible Participants with Company/profile responsibility role badges, participant-level Session entry points, WorkRun entry points, related Tasks created from that Chat room, a stable Activity dock, and Files reserved slot. Context may open Sessions and Tasks through standalone React product destinations, but it must not become the detailed Session, Task, Trace, or Files UI. Context must not fall back to the full Company Directory.
- message timeline uses restrained left/right bubbles: viewer messages align right, other members and AI employees align left, and system/status rows are separate lightweight row types
- runtime employee replies may show compact per-turn token usage in the message meta line, using the linked Session evidence for the source message that triggered that reply. The reply block itself opens the matching Activity dock, and the dock labels the selected reply by sender and time. Token usage is a quiet scan aid, not a replacement for the detailed Sessions usage view.
- concrete message rooms use a mature Chat bottom-follow scroll model: when the viewer is already at the live edge, new messages, streaming drafts, and handoff activity stay pinned to the bottom; when the viewer intentionally scrolls away, the UI must not yank them back. Runtime employee replies and temporary draft replies are not independent scroll anchors. Activity does not occupy the message stream; it updates in the stable Context dock from backend-projected trace evidence. Opening a room or marking messages read must not change the room's content activity time or reorder Topic/DM entry lists. A Channel/Topic handoff chain is one live conversation expansion, not a sequence of viewport resets.
- text composer with Enter to send and Shift+Enter for a new line. Channel and Topic composers support explicit `@` member mention selection for runtime-capable participants; the frontend sends structured mention ids to the backend instead of relying on natural-language name guessing. Emoji, GIF, and sticker entry points are not part of Chat v1
- image attachments for `png`, `jpeg`, and `webp`: the composer supports picking or pasting images, uploads them before send, sends immutable `attachmentIds`, and the message stream renders image thumbnails from backend preview/download URLs. A user may send an image without text; the persisted message body may be empty while the attachment snapshot carries the visible image. General files, GIFs, PDF parsing/OCR, and full file-management UI are not part of Chat v1
- local loading, error, and empty states without refreshing the whole shell

Search is intentionally entry search only: members, Channels, Topics, and chat entries. It is not full message search.

The left rail keeps notification ownership on the product module that can resolve it. Chat shows a lightweight indicator for unread messages, mentions, blocked-recovery conversations, and foreground Access cards. Failed or dispatch-failed execution controls belong to Tasks. TinyOffice does not add a separate cross-module Attention tray or aggregation API.

AI runtime progress is not stored as extra Chat messages such as "received", "thinking", or "completed". The visible message stream contains persisted user and employee messages plus, while a backend Chat run is actively producing text, one temporary streaming draft for that `runId`. Streaming draft text comes from backend `chat.reply.delta` / `chat.reply.snapshot` events and is replaced by the final persisted employee Message after completion; it is not database truth by itself. Activity updates in the stable Chat Context dock, not inline in the message stream. The Activity dock is fetched from the backend Activity projection for the selected source message and can expand raw Process Trace evidence per row. The backend must publish the first real Process Trace step for a run before the first visible assistant reply delta or snapshot, so the user sees work evidence in Context before the message body begins streaming. Participant rows can expose Session entry points for runtime-capable members when message-level evidence can identify the member. While a backend Chat run is active, the composer send control may become a Stop control. Stop must request backend run cancellation by `runId`; it must not simply hide local UI state. Failed turns show a concise failure state. Detailed Session / Process Trace records remain separate evidence in Context and Sessions.

## Permissions

Chat visibility follows formal membership and participation:

- Company scope is mandatory.
- DM history is visible only to DM participants.
- Channel participants can see Channel topics and history.
- Topic visibility inherits Channel visibility.
- Temporary boss-granted access is not a Chat visibility rule. Company-level `boss` is a durable governance identity: it resolves to an effective Channel management role for every Company Channel, even when the persisted Channel membership row is absent or only `member`.

`GET /api/companies/:companyId/directory` is the frontend member-selection boundary for role summaries and runtime availability. Chat visibility still comes from Channel membership and Conversation participants. Context must not replace selected Channel or DM participants with the full Company Directory list.

Persisted Channel membership remains historical collaboration evidence when a member's runtime profile is deactivated. Channel projections resolve the participant's current display name, avatar, and Company role from `company_members`, while `hasRuntimeProfile` is true only for an active complete runtime profile. The frontend may show the historical participant but must not offer runtime actions or new-selection affordances for an inactive member.

The backend enforces this boundary, not only the frontend:

- Production API requests use the current TinyOffice member session as the viewer or actor.
- Development preview may pass `viewerMemberId` / `actorMemberId` or employee selectors explicitly, but it is not a production identity fallback.
- Chat projection removes entries whose `openTarget.roomId` is not visible to the current viewer.
- Direct room reads, message reads, sends, and read-state updates check that the current viewer or actor is a participant before reading messages or mutating the room.
- Runtime context assembly checks that the triggering actor and target runtime employee are allowed room participants before preparing model input.

Runtime access and tool authority still flow through the formal permission model, Session, Process Trace, and Runtime Dispatch. Image attachments are stored as company-scoped Chat attachment records and exposed through backend preview/download routes; broader attachment download policy, non-image files, scanning, and richer file governance remain follow-up slices.

## Boundaries And Follow-Ups

Current boundaries:

- image attachments are real Chat v1 product state for `png`, `jpeg`, and `webp`: upload records live in the company-scoped attachment store, Messages persist immutable attachment snapshots, public DTOs never expose local filesystem paths, and runtime context can include image attachment metadata for the triggering message. The PI-backed runtime provider passes image inputs to PI SDK sessions only when the target employee's configured model declares image input support in the PI model registry. Text-only models fail explicitly at the provider boundary, and the shadcn Chat composer disables image picking and pasted-image upload for direct employee rooms whose target model cannot inspect images.
- uploaded attachment lifetime is governed by durable Message references. Message persistence writes `chat_attachment_references` in the same PostgreSQL transaction as the Message. The uploader may discard an attachment only while it has no Message reference; composer removal/unmount performs eager best-effort discard, and the backend removes stale unreferenced uploads after a 24-hour grace period during attachment service activity. A referenced attachment cannot be removed through the discard API, even if the original uploader requests it.
- Direct Message runtime input behaves like a normal employee Session turn: the model receives the current user message, structured runtime payload, tools, skills, and Prompt Policy blocks, but it does not receive the room's latest raw message window, requester summary, or reachable-participant list as prompt context. Existing PI session continuity carries earlier turns until the provider's own context boundary is reached.
- Channel/Topic runtime context uses progressive disclosure and has no user-visible context switch. Runtime receives explicit Topic context assembled from a System AI-maintained Topic summary, a raw-message window, the current triggering or handoff message, handoff candidates, and approved history lookup tools for older details. Handoff candidates are current Conversation participants excluding the member taking the current turn. On the first turn for a Topic runtime session, the raw-message window is selected from the newest persisted Conversation messages within budget and rendered chronologically. On later turns for the same persistent runtime `sessionKey`, Runtime Dispatch reads the previous Topic context cursor from Session evidence and renders only raw messages after that cursor. System AI summaries live on Conversation Topic state, compress older Topic history, and never replace persisted Conversation messages.
- Topic summaries are backend context state, not Chat messages. After a Channel/Topic employee reply is persisted, Runtime Dispatch may request a System AI topic-summary refresh when the room has crossed the configured message-window threshold. If the System AI provider is missing, disabled, or fails, TinyOffice records audit evidence and keeps the existing summary or no summary; it must not create fake summaries or ask the frontend to synthesize one.
- Activity is shown only from real trace evidence projected by the backend; Chat Context keeps a stable Activity dock with an empty state until a running turn or employee reply is selected. When a concrete message room is reopened, the dock selects the latest employee reply that has explicit Activity evidence, so the user sees the same most recent run without manually reselecting it. Employee replies can expose Activity only when their runtime link carries an explicit source message id, so the dock shows that turn instead of the entire room. Channel/Topic `handoff_topic_turn` evidence is projected as a first-class Handoff activity, not a generic Tool call, and the collapsed Activity row shows the target participant when the trace includes one. Detailed runtime progress remains in Sessions until a separate Trace destination is accepted.
- Session evidence in Chat Context is grouped under the corresponding runtime-capable participant row when message-level evidence can identify the member. WorkRun evidence rows can open the standalone Tasks React rail module. They must not navigate to native HTML pages, plugin routes, console URLs, or retired carrier identifiers.
- Chat Context may show compact related Task links for the selected DM/Topic when the Tasks view model carries a `sourceLink` for the same `conversationId` or `chatEntryId`. This is a navigation affordance only: it does not make Tasks runtime evidence, does not duplicate Task detail fields, and does not replace the standalone Tasks page.
- Chat runtime processing status uses backend realtime status events and linked Session evidence. It must clear stale processing or failure presence on normal room/module navigation and must not synthesize status rows in the Chat message timeline.
- Topic archive removes the topic from normal Channel/DM entry lists without deleting its messages, Sessions, Process Trace, or title state. Channel and DM surfaces expose separate archived-entry views where an operator can restore an entry without keeping archived work in the daily list.
- formal Channel create, detail-update, add-member, remove-member, and dissolve APIs exist on the TinyOffice-owned Channel model; the old temporary `Channel topics` bucket is not product truth. Chat's left Channels rail includes a Channel creation dialog. Chat's right Context rail includes a Channel settings dialog for Channel participants to edit Channel title/summary, add directory members, and remove members. Dissolving a Channel is a hard delete, not archive: it permanently removes the Channel, membership, Channel topics, and message history after the operator types `DELETE` and confirms the destructive dialog. The backend rejects dissolve while any Topic in that Channel has a running Chat execution. Before deleting the conversations, it cancels pending Topic-scoped Access requests, removes Topic-scoped grants, and deletes attachment records/files that have no surviving Message reference; an attachment that is also referenced by a surviving conversation remains available. Tasks created from those Topics remain as historical execution evidence; their source is marked unavailable before the Channel is deleted so Tasks never navigate to a missing room. The current daily Chat surface intentionally does not expose role editing, public/private switching, invite links, or notification controls; those require separate product decisions.
- Channel participant badges in Chat Context may show Company/profile responsibility roles such as `boss`, `hr`, `image-review`, or `web-designer` when the Company Directory can enrich the participant. Channel membership itself is only the visible participant list and does not carry a separate `owner`, `admin`, or `member` role layer.
- explicit `@` mention is the only Channel/Topic frontend trigger for waking a runtime-capable member. Display text such as a member name in the message body must not be interpreted as a mention unless the composer selected that participant and sent the matching structured `mentionedMemberIds`.
- Channel/Topic runtime context must expose `Handoff candidates` with stable ids, display names, and product roles/responsibilities when available. The list excludes the member taking the current turn; the model should choose `handoff_topic_turn.toId` from those candidates using the current topic, roles, and recent messages. The frontend and prompt context must not split candidates into human-vs-AI product categories. Unsupported Conversation kinds fail closed at runtime dispatch; TinyOffice must not silently map them into a shared-room prompt mode.
- Access Requests raised from a Chat room appear as foreground cards in that same room. The card lets the approver allow once, allow in this conversation, or reject without leaving the conversation. The Access rail remains policy configuration and preview, not the primary request-approval surface and not a generic attention inbox.
- The Chat rail indicator is derived from viewer-scoped unread/mention state and pending foreground Access cards. Handoffs and blocked-recovery requests arrive as ordinary Chat messages; reading or responding happens in Chat, not in a separate Attention tray.

Related technical contracts:

- [Conversation / Message Contract](../technical/conversation-message-contract.md)
- [Chat Entry Contract](../technical/chat-entry-contract.md)
- [TinyOffice Realtime WebSocket](../technical/tinyoffice-realtime.md)

## Minimum lifecycle closures

- A failed employee turn can be retried from the original user Message. Retry creates a new execution attempt and preserves the failed attempt as evidence; it does not insert a duplicate user Message.
- Creating a new DM entry validates the peer at the backend boundary against the active Company directory. Forged container ids cannot create new conversations for inactive, missing, or cross-Company members. Retrying a failed employee turn also revalidates that the target is both a participant in the original room and an active runtime-capable member; the API must not acknowledge a retry that cannot run.
- Channel Topics may be archived, listed in a Channel-scoped Archived Topics view, and restored. The ordinary Channel topic directory renders active Topics only. Its header opens the separate archive view; archived Topics never occupy space in the daily production list. Archive does not delete Messages or runtime evidence.
- DM conversation entries use the same visible archive/restore workflow inside their member DM container, but archive visibility is personal: archiving a DM entry does not hide it for the other participant. A later Message automatically returns that DM entry to the active list.
- Topic `completed` or `resolved` states are intentionally not introduced. The user decides whether to continue a restored/open Topic or leave it archived.

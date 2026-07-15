# Topic / Handoff Technical Implementation

This page records the current implementation boundary for Topic / Handoff. Product behavior is described in [Topic / Handoff](../product/topic-handoff.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/channel-topics/` | Topic owner, participants, owned room identity, seen cursors, and handoff rows. |
| `src/runtime/realtime/handoff-replay-ledger.ts` | Handoff replay/idempotency ledger. Owned action/room identity is preferred over legacy `threadId`. |
| `src/runtime/chat/chat-topic-chain-repository.ts` | Durable Topic-chain state, one-active-chain constraint, current holder/run revision, and cancel lookup across child runs. |

## Database Boundary

`channel_topics` now has owned identity columns:

- `owner_member_id`
- `participant_member_ids_json`
- `room_id`
- `conversation_id`
- `chat_entry_id`
- `identity_source`

Topic owner and participant storage is member-only. Current pre-release storage must not add `owner_employee_id`, `participant_employee_ids_json`, or fallback projection fields for Topic ownership.

`channel_topic_handoffs` and `handoff_replay_ledger` also carry owned room/action evidence. Current pre-release storage should not add legacy carrier evidence fields or migration-diagnostic fields as product identity.

Channel handoff context uses progressive disclosure. The receiver gets shared Topic context from handoff candidates, a raw-message window, and the System AI-maintained Topic summary for older history. The current trigger is marked in the raw window and is not appended again as a standalone message. The first turn for a persistent Topic `sessionKey` uses the newest 20 messages. Later turns use the previous Topic context cursor from runtime Session evidence and include every raw message after that cursor. Older raw messages are available through explicit history lookup tools; there is no product context-mode switch.

Runtime context exposes `Handoff candidates` rather than the full visible participant roster. Candidate context includes display name, stable id, and product role/responsibility, and excludes the runtime member taking the current turn. `handoff_topic_turn.toId` must target a listed candidate. Runtime Dispatch owns the execution decision after the model selects `toId`; prompt context must not describe candidates as human-vs-AI or return-to-user handoff classes.

The `handoff_topic_turn` tool validates `toId` against that turn's `reachableParticipants` while the tool call is executing. An unknown id fails immediately and the provider can correct the tool call within the same turn; it must not be accepted as successful Handoff evidence and discovered only after the visible reply has finished. The final Chat boundary still enforces exactly one successful Handoff as the authoritative invariant.

`chat_topic_chains` is the durable single-ball control record. `chat_topic_chain_runs` links every child `runId` to the same `chainId`. A partial unique index permits only one `active` or `cancel_requested` chain per Topic room. Handoff advances `current_run_id` and `current_holder_member_id` with an expected-current-run guard before the child queued event is published. Cancel can therefore resolve an older visible run id to the actual current holder.

## Rules

- New product code must identify topic rooms with `chatEntryId`, `conversationId`, `roomId`, or action/runtime ids.
- Do not derive new product topic ids from carrier post/thread ids.
- Topic identity is `tinyoffice_room` and must use owned `roomId`, `conversationId`, or `chatEntryId`.
- Do not downgrade an owned topic back to `legacy_carrier_root_post` when a legacy carrier wake references the same topic.
- Seen cursors for owned rooms should use `roomId` and `messageId`.
- Replay/idempotency should use a handoff `actionId` when available, then owned room identity.
- Recovered or suppressed handoff action evidence should preserve `roomId`, `conversationId`, `chatEntryId`, and `actionId`.
- Recovered or suppressed handoff action evidence must use owned room, conversation, chat entry, action, and participant ids.
- A Topic message produces one initial dispatch only. Multiple structured mentions select the first id; no mention uses a SHA-256-derived stable selection over sorted eligible runtime participant ids.
- `handoff_topic_turn` must appear exactly once in every Channel Topic turn. Selecting the user's participant id returns control to the user.
- Handoff count is unlimited. Runtime/provider timeouts remain operational failure boundaries, not product Handoff limits. The provider HTTP idle timeout is currently 120 seconds of connection inactivity; it is not a total employee-work duration or Topic-turn-count limit.
- If final Handoff validation fails after provider execution, both the Chat dispatch and its runtime Session record must finish as `failed`; a completed runtime Session must not coexist with a failed Topic turn.
- Topic cancellation validates the requesting actor against Conversation participation, marks the chain `cancel_requested`, aborts its current run, blocks a later Handoff, and suppresses late provider output.

## Focused Tests

```powershell
node --import tsx --test tests\runtime\channel-topic-service.test.ts
node --import tsx --test tests\runtime\collaboration-action-boundary.test.ts
node --import tsx --test tests\collaboration\collaboration-actions-extension.test.ts
node --import tsx --test tests\runtime\tinyoffice-chat-turn-dispatch.test.ts
node --import tsx --test --test-name-pattern "buildHandoffReplayKey" tests\runtime\handoff-replay-ledger.test.ts
node --import tsx --test tests\runtime\postgres-schema.test.ts
```

Full runtime tests still require the local PostgreSQL test database.

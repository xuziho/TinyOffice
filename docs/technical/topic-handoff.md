# Topic / Handoff Technical Implementation

This page records the current implementation boundary for Topic / Handoff. Product behavior is described in [Topic / Handoff](../product/topic-handoff.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/channel-topics/` | Topic owner, participants, owned room identity, seen cursors, and handoff rows. |
| `src/runtime/realtime/handoff-replay-ledger.ts` | Handoff replay/idempotency ledger. Owned action/room identity is preferred over legacy `threadId`. |

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

Channel handoff context uses progressive disclosure. The receiver should get shared Topic context from the current handoff message, handoff candidates, a raw-message window within the context budget, and the System AI-maintained Topic summary for older history. The first turn for a persistent Topic `sessionKey` uses the recent raw-message window. Later turns for the same `sessionKey` use the previous Topic context cursor from runtime Session evidence and include only raw messages after that cursor. Older raw messages are available through explicit history lookup tools; there is no product context-mode switch.

Runtime context exposes `Handoff candidates` rather than the full visible participant roster. Candidate context includes display name, stable id, and product role/responsibility, and excludes the runtime member taking the current turn. `handoff_topic_turn.toId` must target a listed candidate. Runtime Dispatch owns the execution decision after the model selects `toId`; prompt context must not describe candidates as human-vs-AI or return-to-user handoff classes.

## Rules

- New product code must identify topic rooms with `chatEntryId`, `conversationId`, `roomId`, or action/runtime ids.
- Do not derive new product topic ids from carrier post/thread ids.
- Topic identity is `tinyoffice_room` and must use owned `roomId`, `conversationId`, or `chatEntryId`.
- Do not downgrade an owned topic back to `legacy_carrier_root_post` when a legacy carrier wake references the same topic.
- Seen cursors for owned rooms should use `roomId` and `messageId`.
- Replay/idempotency should use a handoff `actionId` when available, then owned room identity.
- Recovered or suppressed handoff action evidence should preserve `roomId`, `conversationId`, `chatEntryId`, and `actionId`.
- Recovered or suppressed handoff action evidence must use owned room, conversation, chat entry, action, and participant ids.

## Focused Tests

```powershell
node --import tsx --test tests\runtime\channel-topic-service.test.ts
node --import tsx --test tests\runtime\collaboration-action-boundary.test.ts
node --import tsx --test --test-name-pattern "buildHandoffReplayKey" tests\runtime\handoff-replay-ledger.test.ts
node --import tsx --test tests\runtime\postgres-schema.test.ts
```

Full runtime tests still require the local PostgreSQL test database.

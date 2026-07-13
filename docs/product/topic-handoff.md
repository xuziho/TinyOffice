# Topic / Handoff

Topic / Handoff describes how a TinyOffice topic room keeps a single current owner and how ownership moves between company participants.

## Product Identity

The product identity for a Topic Room is TinyOffice-owned:

- `chatEntryId`
- `conversationId`
- `roomId`
- action/runtime ids such as a handoff action id or session/runtime link

Historical source anchors may exist for older rows, but the product key for Topic/Handoff is TinyOffice-owned room and action identity.

## Purpose

- Keep one shared topic room as the collaboration site.
- Make the current owner explicit.
- Make handoff visible, auditable, and replay-safe.
- Keep seen cursors relative to owned room/message ids for the new product path.

## Concepts

| Concept | Meaning |
| --- | --- |
| Topic Room | A TinyOffice Chat topic entry backed by a Conversation room. |
| Owner | The participant currently responsible for continuing the topic. |
| Handoff | A formal ownership transfer from one participant to another. |
| Seen cursor | A per-employee cursor for room context, using `roomId` and `messageId`. |

Channel topics use a single-ball handoff model. The participant taking the current turn writes the visible reply and calls `handoff_topic_turn` exactly once during the same turn with the participant id that should own the next step. The model chooses that participant from `Handoff candidates`, a current Conversation participant list that excludes the actor taking the turn. Runtime starts the next turn only after the current reply is persisted.

The model must receive enough candidate context to choose responsibly: display name, stable id, and product role or responsibility. A bare id list is not sufficient product context, and prompt context must not turn candidates into human-vs-AI product categories.

## Current Status

Current ChannelTopic identity is moving toward owned room identity:

- `ChannelTopic` can store `roomId`, `conversationId`, `chatEntryId`, and `identitySource`.
- owned seen cursors can record `roomId` / `messageId`.
- handoff owner rows inherit the topic's owned room ids.
- handoff replay keys and recovered handoff action evidence prefer owned action/room identity.

## Remaining Blockers

- A dedicated owned Handoff action API and final-report notification renderer are still follow-up work.

## Technical Reference

See [Topic / Handoff Technical Implementation](../technical/topic-handoff.md).

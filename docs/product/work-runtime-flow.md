# Work Runtime Flow

This page explains how a WorkRun moves from queue to execution to a terminal or blocked state.

```mermaid
flowchart TD
  A["WorkSchedule or immediate WorkTask creates WorkRun"] --> B["WorkRun status: queued"]
  B --> C["Dispatch loop creates lease"]
  C --> D["Start assignee work_run_execution session"]
  D --> E["Employee investigates and uses normal tools"]
  E --> F["Employee calls finish_work_turn"]
  F --> G["Runtime parses and validates result"]
  G --> H{"Result status"}
  H -->|in_progress| I["Record progress event and continue within budget"]
  H -->|complete| J["Mark WorkRun done with evidence"]
  H -->|blocked| K["Keep WorkTask active and mark WorkRun blocked"]
  K --> O["Open or reuse this WorkRun's recovery DM"]
  O --> P["Requester replies in DM"]
  P --> Q["Resume original WorkRun session"]
  Q --> F
  H -->|failed| L["Mark WorkRun failed"]
  L --> R["Optional retry creates a new queued WorkRun"]
  R --> B
  H -->|canceled| M["Mark WorkRun canceled"]
```

## Execution Principles

- WorkRun state is advanced only through `finish_work_turn`.
- Runtime is the only writer of WorkRun state.
- `complete` must include evidence.
- `blocked` must explain the blocker.
- A blocker needs one concise reason; it does not require a product-level blocker taxonomy.
- A WorkRun owns one linked direct message between the assignee and requester for its whole lifecycle. Repeated blockers reuse it.
- A requester reply wakes the original WorkRun Session. It does not itself clear the blocker; the employee's turn result determines the next WorkRun state.
- Tasks does not expose a manual "resume from participant" action; the recovery path is the linked DM conversation.
- Tasks does not create `blocked` state directly. It can cancel active work, retry a failed dispatch, or create a new retry WorkRun from a failed attempt.
- AI can cancel, archive, restore, or retry Work and pause, resume, or cancel schedules after explicit operator confirmation in Chat.
- The WorkRun result schema has no approval fields; Access is created only by the concrete tool/access layer.
- Sensitive-resource Access requests are created by the concrete tool/access layer when the employee touches the resource.
- Ordinary messages can clarify an Access request but cannot grant permission. Only an Access decision creates a grant.
- `in_progress` means the turn made progress but is not terminal; Runtime decides whether to continue within budget.
- A need to change assignee is reported as `blocked`; WorkRun reassignment is not exposed until it has real ownership and continuation semantics.
- Canceling a Task or Run aborts the exact `work_run_execution` Session, cancels dispatch ownership, closes recovery, and suppresses late provider results.

## Relationship To Collaboration

- Intake can create background Work through `finish_intake_turn` `create_work`.
- Channel Topic handoff uses Chat `handoff_topic_turn` to update Topic owner.
- WorkRun completion, blocker, failure, and cancellation do not directly change Topic owner.
- Blocked recovery messages are normal TinyOffice Chat DMs with WorkRun runtime links, so the requester can ask follow-up questions before the employee resumes or cancels the work.
- Access requests can be associated with WorkRun or foreground contexts, but approval does not make Runtime execute a business continuation by itself.

## Verification

```powershell
node --import tsx --test tests\work\work-execution-service.test.ts tests\runtime\postgres-schema.test.ts
```

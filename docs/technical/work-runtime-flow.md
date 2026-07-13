# Work Runtime Flow Technical Implementation

This page records the technical boundary for WorkScheduler, WorkDispatcher, and WorkExecution. Product behavior is documented in [Work System](../product/work-system.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/work/work-dispatcher.ts` | Select runnable queued WorkRuns. |
| `src/work/work-dispatch-lease.ts` | Create, ack, fail, and cancel dispatch leases. |
| `src/work/work-dispatch-runner.ts` | Connect dispatcher, lease, and execution service. |
| `src/work/work-execution-service.ts` | Start employee `work_run_execution` session and apply `finish_work_turn`. |
| `src/work/finish-work-turn-result.ts` | Define and validate `finish_work_turn` result policy. |
| `src/work/work-blocked-recovery-service.ts` | Build blocked WorkRun continuation context and resume the original WorkRun session after requester input. |
| `src/work/work-blocked-recovery-conversation-service.ts` | Open the linked recovery DM and consume requester replies before normal Chat dispatch. |
| `src/work/work-blocked-recovery-request.ts` | Persist the WorkRun-to-recovery-DM link and open/resolved lifecycle. |

## Data Flow

1. WorkSchedule, or an immediate WorkTask action, creates a WorkRun.
2. WorkRun enters `queued`.
3. Dispatcher selects a runnable WorkRun. An explicit Tasks retry lease is prioritized and reused for its exact queued Run.
4. Lease service creates a pending lease for ordinary dispatch, or reuses the linked retry lease.
5. Execution service moves the run to `in_progress` and starts the employee session.
6. Employee calls `finish_work_turn` at the end of a turn.
7. Runtime validates and applies status, evidence, and blocker fields.
8. Runtime writes WorkRun state and events.
9. If the result is blocked, Runtime records the blocker and opens or reuses one linked recovery DM between assignee and requester.
10. A requester reply in that DM is consumed by blocked recovery before normal Chat runtime dispatch.
11. Recovery resumes the original WorkRun session with the participant reply in the WorkRun context block. An intermediate `in_progress` result is auto-continued inside the same recovery operation. If the employee still needs clarification or continuation budget is exhausted, the run returns to `blocked` and the same DM remains open; recovery resolves only after a stable non-blocked result.
12. If the participant explicitly changes the objective, the employee confirms the replacement goal and uses `work.revise`; Runtime records a new Task revision and advances the same WorkRun to it before continuing.
13. A failed WorkRun may be retried by creating a new queued WorkRun with `retryOfWorkRunId` event evidence. The failed attempt is never rewritten.
14. External cancellation marks the WorkRun authoritative as canceled, cancels pending or acknowledged dispatch ownership, closes blocked recovery, aborts the exact runtime session, reconciles its Session record to `canceled`, and rejects late provider events/results.
15. Terminal WorkRun transitions cancel pending WorkRun-scoped Access requests; Access-list reads reconcile the same invariant after a transient cleanup failure.

The WorkRun result schema has no approval fields; Access owns sensitive-resource approvals.

Capability mutations in Chat use the message actor as `actorMemberId`. A WorkRun continuation has no Chat message actor, so `work.revise` and other Work lifecycle capabilities use the current runtime employee as the mutation actor while preserving the operator confirmation in Session and Conversation evidence.

Sensitive-resource Access requests are created by the tool/access layer, not by WorkRun final result parsing.

## State Handling

| `finish_work_turn.status` | Runtime behavior |
| --- | --- |
| `in_progress` | Record progress event and keep or restore `in_progress`. |
| `complete` | Require evidence and mark done. |
| `blocked` | Mark blocked, save blocker evidence, and open or reuse a linked recovery DM. |
| `failed` | Mark failed. |
| `canceled` | Mark canceled. |

One missing `finish_work_turn` receives one repair turn in the same Session. The second missing call, or multiple calls in one turn, remains a protocol failure.

WorkTask status is intentionally narrower: `active`, `completed`, `canceled`, and `archived`. WorkRun failure does not pause or fail the WorkTask. Tasks exposes retry for failed WorkRuns and cancel for active WorkTasks/runs; it does not expose manual participant resume or stop-to-block actions.

`finish_work_turn` intentionally has no WorkRun handoff result until real assignee reassignment and continuation-session ownership exist. A need to change employees is a normal `blocked` reason.

WorkSchedule state never derives from WorkRun success, failure, or cancellation. Schedule completion means the once-only trigger fired or a bounded recurring trigger exhausted its run budget. Explicit pause/resume/cancel remains an operator-controlled schedule lifecycle.

`scheduledFor` is an absolute RFC3339 instant and is normalized to UTC. Offset-less timestamps are rejected even when a timezone label is supplied. `timezone` is retained for product display and future local-time recurrence semantics.

## Tests

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests\work\work-execution-service.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests\work\work-blocked-recovery-conversation-service.test.ts
```

# Evidence Query CLI

Evidence Query CLI gives TinyOffice runtime-capable members and operators a stable way to inspect persisted company evidence without raw SQL.

## Product Contract

- Commands are repository-backed queries. There is no `query sql` command and no arbitrary SQL execution.
- JSON is the default output for AI/tool use.
- `--summary` renders a one-line human-readable summary for quick terminal checks.
- Realtime progress still belongs to Process Trace and runtime event streams. The CLI is for persisted evidence lookup, not polling.
- The command surface is general: runtime-capable members, WorkTask/WorkSchedule/WorkRun, sessions, trace, actions, intake, approvals, grants, ops, and runtime memory.

Every JSON response follows this envelope:

```json
{
  "ok": true,
  "query": {
    "command": "member-state",
    "memberId": "iris-growth"
  },
  "generatedAt": "2026-06-21T10:00:00.000Z",
  "summary": "member-state iris-growth: 1 active work runs, 1 sessions",
  "detail": {}
}
```

List commands return `items`. Detail commands return `detail`. Some commands include `evidence` or `links` when an identifier helps connect related records.

## Commands

Implemented first set:

| Command | Use |
| --- | --- |
| `query members` | List configured runtime-capable members. |
| `query member <memberId>` | Inspect one runtime-capable member identity/config snapshot. |
| `query member-state <memberId>` | Inspect what a runtime-capable member is doing: work, sessions, actions, approvals, grants, ops, and memory. |
| `query work --member <memberId> --status <status>` | List WorkRuns by assignee and optional status. |
| `query work-run --id <workRunId>` | Inspect one WorkRun with its plan and events. |
| `query work-run-events --id <workRunId>` | List WorkRun event history. |
| `query work-queue --member <memberId>` | List queued WorkRuns for a runtime-capable member. |
| `query sessions --member <memberId> --since <duration>` | List sessions for a runtime-capable member, optionally filtered by duration such as `12h` or `7d`. |
| `query session --id <sessionRecordId>` | Inspect one session with events. |
| `query session-events --id <sessionRecordId> --kind <kind>` | List session events, optionally by kind. |
| `query session-input --id <sessionRecordId>` | Show user/prompt/model-input context recorded for a session. |
| `query trace --work-run <workRunId>` | List Process Trace events for a WorkRun. |
| `query trace --session <sessionRecordId>` | List Process Trace events related to a session key. |
| `query trace --member <memberId>` | List Process Trace events for a runtime-capable member. |
| `query actions --member <memberId>` | List collaboration action evidence for a runtime-capable member. |
| `query actions --work-run <workRunId>` | List collaboration action evidence for a WorkRun. |
| `query intake --status <status>` | List intake events by processing status. |
| `query intake --member <memberId>` | List intake events routed to a runtime-capable member. |
| `query intake --id <intakeEventId>` | Inspect matching intake event records. |
| `query approvals --status <status> --member <memberId>` | List approval requests by status and requester. |
| `query grants --member <memberId>` | List approval grants for a member. |
| `query ops --severity <severity> --member <memberId>` | List operating log events by severity and actor. |
| `query memory --member <memberId>` | List runtime memory summaries for a runtime-capable member. |

Deferred:

- Rich cross-record links for every command.
- Streaming or tailing live events.
- Permission-aware field masking beyond avoiding raw credentials and raw SQL.
- Custom saved query presets.

## Examples

```bash
node --import tsx src/cli/agentco.ts query member-state iris-growth
node --import tsx src/cli/agentco.ts query work --member iris-growth --status blocked
node --import tsx src/cli/agentco.ts query work-run --id work-run-123 --summary
node --import tsx src/cli/agentco.ts query session-input --id session-record-123
node --import tsx src/cli/agentco.ts query approvals --member iris-growth --status pending
```

## Boundaries

- Use Tasks and Session Explorer for operator UI reading.
- Use Process Trace / runtime event streams for realtime progress.
- Use Evidence Query CLI for operator and developer diagnosis from terminal/tool context.
- Do not ask members to invent database table names or run SQL.
- Query filters use `memberId` at the CLI boundary. Runtime/session evidence records may still expose `employeeId` internally when the field describes the executing runtime-capable member.

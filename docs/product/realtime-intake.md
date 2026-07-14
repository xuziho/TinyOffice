# Realtime Intake

Realtime Intake is the entry point for TinyOffice-owned Chat events and external events entering runtime dispatch. It routes events to runtime-capable members and sessions; it is not an automatic background-work generator.

Runtime requests must carry explicit TinyOffice Company context before loading members, Topic, Work, Session, Prompt, Access, Process Trace, Operating Log, or collaboration action services. `TINYOFFICE_COMPANY_ID` is only a bootstrap/diagnostic input for commands that cannot carry Company context yet; it is not a hidden fallback for product runtime events.

## Main Flow

```text
TinyOffice Chat message or external intake event
  -> realtime intake API
  -> Company context resolves from the owned API request
  -> target runtime-capable member resolution
  -> session key derivation
  -> persistent member runtime
  -> scene final-result validation
  -> owned Chat message, Work creation, or operating evidence
```

## Target Resolution

Realtime Intake only does lightweight target resolution. It does not infer arbitrary business intent from natural language.

| Source | Routing rule |
| --- | --- |
| Channel/Topic message | The first structured runtime-capable mention is routed. |
| Channel/Topic message without runtime-capable target | One eligible runtime participant is selected deterministically. Literal `@all` follows this same route. |
| DM message | Routed only when the DM uniquely maps to one runtime-capable peer. |
| Runtime handoff | Routed by structured `toId`; visible mentions are only text. Runtime Dispatch validates the selected participant and decides whether another runtime turn can be started. |
| External intake event | Must provide `routing.targetMemberId`. |

For TinyOffice-owned Chat, DM and Channel/Topic employee replies are written from the model's normal assistant reply. Every Channel/Topic turn must additionally use `handoff_topic_turn.toId` exactly once as the structured handoff target. Runtime Dispatch records that participant and starts the next runtime turn only when the selected participant can be executed; selecting the user returns the ball without starting an employee turn. The handoff tool is a state action only and must not carry a visible reply message. Runtime failures stay in Session and Process Trace evidence and do not create successful Chat reply messages.

## API Entries

| Route | Purpose |
| --- | --- |
| `GET /health` | Health check. |
| `POST /api/companies/{companyId}/intake/events` | External intake event entry. |
| `GET /api/process-trace` | Query process events. |
| `GET /api/process-trace/stream` | Stream process events. |
| `GET /api/runtime/ws` | Runtime WebSocket endpoint for runtime/process events. It is not a Console UI entrypoint. |
| `POST /api/approvals/{approvalId}/resolve` | Resolve a foreground Access request. |
| `POST /api/agent-controls/reload-employee` | Reload one employee runtime. |
| `POST /api/agent-controls/reload-employees` | Reload all employee runtimes. |

## Minimum external event

The company-scoped `Integrations` page is the human-facing discovery entry. It explains what external inputs can do and links to ordinary Chat, where the user can ask an AI employee to build the connection. It does not create a separate setup intent or wizard. Protocol details are intentionally not shown as a human setup form. An AI employee first calls `intake.integration.describe` to retrieve the current endpoint, payload contract, target-member lookup capability, idempotency rule, and receipt shape. The resulting integration sends JSON with `Content-Type: application/json`:

```json
{
  "schemaVersion": "2026-07-09",
  "source": "your-system",
  "sourceEventId": "unique-event-id",
  "category": "external.signal",
  "routing": {
    "targetMemberId": "employee-member-id"
  },
  "priority": "normal",
  "summary": "What happened and why it matters.",
  "payload": {
    "key": "source-specific data"
  }
}
```

`routing.targetMemberId` must identify an active runtime-capable member in the Company. The combination of `category`, `source`, and `sourceEventId` is the idempotency boundary; retry the same external event with the same values.

## External Intake Outcomes

External intake triage uses `finish_intake_turn`.

| `outcome` | Meaning | Runtime behavior |
| --- | --- | --- |
| `create_work` | Promote the signal into background work. | Create WorkTask and, when immediate, a queued WorkRun. Scheduled work creates or updates a WorkSchedule. |
| `record_event` | Keep an operating trace only. | Record operating event; do not create Work. |

The current product path is: employees decide whether a signal becomes Work. Access requests are created by the tool/access layer only when a concrete sensitive resource or high-risk command is touched.

## Boundaries

- Do not build thick business workflows inside intake.
- Do not infer all possible business intent from natural language.
- Do not convert external intake automatically into WorkTask, WorkSchedule, or WorkRun.
- Do not use intake final output to create broad business approvals.
- Do not default runtime events to `tinyoffice`, the first Company, or `TINYOFFICE_COMPANY_ID`.
- Missing or unknown Company context is invalid runtime state and fails before member/config/runtime data is loaded.

## Health

`GET /health` reports neutral runtime status and any Company contexts that have been loaded in this process:

```json
{
  "ok": true,
  "loadedCompanyContexts": [
    {
      "companyId": "acme-ops",
      "employeeIds": ["avery-ops"]
    }
  ]
}
```

Health output does not imply a single global Company.

## Verification

```powershell
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
npm start
```

Then verify runtime health when the local preview server is running:

```text
GET http://127.0.0.1:8095/health
```

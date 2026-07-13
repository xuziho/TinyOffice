# Intake Event Contract

This page defines the company-level envelope for external automation input entering TinyOffice.

`Intake Event` is a stable envelope. Scripts, n8n workflows, email parsers, monitors, and future connectors should use this envelope when they deliver external events to TinyOffice.

An Intake Event does not automatically become background work. It is first persistent input evidence. Runtime delivers it to the `intake_event` session for `routing.targetMemberId`; the runtime-capable member then uses role, tools, Skills/Runbooks, and context to choose an outcome in `finish_intake_turn`.

## Endpoint

```http
POST /api/companies/{companyId}/intake/events
Content-Type: application/json
```

## Envelope

```json
{
  "schemaVersion": "2026-06-05",
  "source": "n8n",
  "sourceEventId": "website-qa-run-001",
  "category": "website.article_audit",
  "routing": {
    "targetMemberId": "nora-automation"
  },
  "priority": "high",
  "occurredAt": "2026-06-05T10:00:00.000Z",
  "summary": "3 published articles are missing featured images.",
  "payload": {}
}
```

Required fields:

- `schemaVersion`
- `source`
- `sourceEventId`
- `category`
- `routing.targetMemberId`
- `payload`

## Outcomes

The receiving employee may return:

| `outcome` | Meaning | Runtime behavior |
| --- | --- | --- |
| `create_work` | The signal should become formal background work. | Create WorkTask and possibly a queued WorkRun; scheduled work creates or updates a WorkSchedule. |
| `record_event` | The signal should only leave an operating trace. | Record the event; do not create Work. |

## Relationship To Work

Only `create_work` creates Work. Do not assume:

- every intake event creates a WorkTask
- intake `category` equals final WorkTask ownership
- intake `category` owner equals final WorkRun assignee

Those are employee triage decisions.

## Response Shape

New event:

```json
{
  "status": "processed",
  "eventId": "intake-event-...",
  "category": "website.article_audit",
  "result": {
    "kind": "intake_event_routed",
    "category": "website.article_audit",
    "targetMemberId": "nora-automation"
  }
}
```

Duplicate event:

```json
{
  "status": "duplicate",
  "eventId": "intake-event-...",
  "category": "website.article_audit",
  "result": {
    "kind": "intake_event_routed",
    "category": "website.article_audit",
    "targetMemberId": "nora-automation"
  }
}
```

# Access Requests And Process Trace Technical Implementation

This page records the implementation boundary for Access-request storage and Process Trace. Product behavior is documented in [Access Requests](../product/approval.md) and [Process Trace](../product/process-trace.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/governance/` | Approval/Grant persistence used by Access requests. |
| TinyOffice-owned frontend/API Access surface | Presents and resolves foreground Access requests. |
| `src/runtime/storage/` | Process trace, session event, and usage records. |

## Boundary

Approval records remain the database object for Access requests. They bind a Company Member, resource/action, context, reason, optional input snapshot, decision, and optional grant.

Runtime no longer creates broad business approvals from channel, DM, intake, or WorkRun final-output requests. Retired final-output approval fields are rejected; sensitive-resource requests must originate from the concrete tool/access layer.

Approving a foreground Access request creates a scoped grant, normally one-time. Runtime must not use that decision to execute a business continuation itself. The original member/session retries the original tool path and reports through the normal scene final output.

Process Trace records runtime evidence and does not replace the main readable thread reply.

## Tests

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests\governance\company-governance-persistence.test.ts tests\runtime\process-trace-store.test.ts
```

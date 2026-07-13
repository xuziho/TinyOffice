# Access Technical Implementation

This page records the current implementation boundary for Access. Product behavior is documented in [Access](../product/tool-safety.md).

## Naming

The user-facing name is **Access**. Some internal identifiers still contain `tool-safety` or `tool-guard` because tables and implementation files predate the rename.

Do not expose Tool Guard or Tool Safety as the product name in current UI copy.

## Current Modules

| Module | Responsibility |
| --- | --- |
| `src/runtime/provider/runtime-tool-contracts.ts` | Single registry for model-visible runtime tools, their execution-boundary kind, and scene-specific active tool lists. |
| `src/runtime/company-config/tool-guard-admin.ts` | Access view model, save, and technical decision preview. |
| `src/runtime/company-config/access-request-service.ts` | Projects Approval records as Access requests and resolves allow/reject decisions into scoped grants. |
| `packages/pi-tool-guard` | Low-level read/write/bash policy classification. |

Retired broad permission engines are not part of the current Access boundary. Access decisions come from the concrete tool/access classifier when a low-level resource or command is touched. Access is a tool-call guardrail, not a sandbox or a complete action-permission matrix.

## Model-Visible Tool Boundary

Every model-visible TinyOffice runtime tool must be declared in `runtime-tool-contracts.ts` before it can be exposed to a scene. The registry is the boundary checklist for future tool additions:

| Boundary kind | Current tools | Boundary rule |
| --- | --- | --- |
| `guarded_os_tool` | `read`, `grep`, `find`, `ls`, `write`, `edit`, `bash` | Low-level filesystem and shell access. These tools are classified by `packages/pi-tool-guard`; sensitive or dangerous operations go through Access. |
| `tinyoffice_capability_tool` | `tinyoffice_capability_list`, `tinyoffice_capability_describe`, `tinyoffice_capability_call` | TinyOffice business capability access. This is governed by the capability registry allowlist, company scoping, runtime actor context, and capability-specific confirmation rules; it is not treated as low-level Access. |
| `protocol_tool` | `handoff_topic_turn`, `finish_work_turn`, `finish_intake_turn` | Runtime protocol exits. These tools report scene state and are validated by the scene result contract. |
| `read_only_memory_tool` | `recall_memory` | Company-scoped runtime memory read. It does not mutate routing, work state, or filesystem resources. |
| `network_tool` | `webfetch`, `websearch` | External network access. This is separate from Access; future network policy should use this boundary rather than path-sensitive Access rules. |

Scene active tool lists must be derived from the same registry. Chat, WorkRun, and future runtime scenes should not maintain independent string arrays that can drift from the declared execution boundary.

## Storage

Current Access policy truth lives in PostgreSQL `tool_safety_policies`. Retired JSON policy files must not be recreated as runtime fallback, seed/export input, or hidden compatibility source.

## Routes

| Route | Purpose |
| --- | --- |
| `/api/companies/:companyId/access` | Current product API for reading and saving company-scoped Access policy. |
| `/api/companies/:companyId/access/preview` | Technical helper for previewing one read, write, or bash decision. |
| `/api/companies/:companyId/access/requests` | Lists foreground Access requests. |
| `/api/companies/:companyId/access/requests/:approvalId/resolve` | Resolves one request as allow once, allow in this conversation, or reject. |
| `/api/companies/:companyId/access/tool-call` | Runtime bridge endpoint used by the PI guard to create a request or consume a matching grant before a guarded tool call runs. |

## Approval Boundary

Approval records are retained as the foreground Access-request interaction layer. Approving creates a scoped grant. The original employee/session owns retrying the blocked tool call and sending the final scene reply.

For `ask` decisions, the PI guard calls the company-scoped runtime bridge endpoint before returning the block. The bridge creates or reuses a pending Access request when no grant matches. On retry, a matching session grant allows the call, and a matching one-time grant is consumed before allowing the call. `deny` decisions stay hard-blocked and do not create requests.

Pending requests with `contextKind = work_run` cannot outlive a terminal WorkRun. The Work terminal hook cancels them, and the Access request projection reconciles terminal WorkRun status before returning foreground cards.

## Verification

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/company-config-tool-guard.test.ts
node --import tsx --test tests/pi-tool-guard-policy.test.ts
node --import tsx --test tests/runtime/access-request-service.test.ts
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/api/tinyoffice-api.test.ts
node --import tsx --test tests/architecture/access-boundary-hard-cut.test.ts
node --import tsx --test tests/architecture/tool-execution-boundary.test.ts
```

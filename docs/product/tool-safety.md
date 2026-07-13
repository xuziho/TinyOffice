# Access

Access is TinyOffice's runtime guard for sensitive resources and high-risk commands. It is a narrow tool-call guard, not a sandbox, not a full business permission system, and not a place to model every possible AI action.

User-facing name: **Access**.

## What It Controls

Access controls low-level resource and command access, not broad business work.

| Group | Typical resources | Read | Write / execute |
| --- | --- | --- | --- |
| Environment config | `.env`, `.env.*` | configurable: allow / ask / deny | configurable: allow / ask |
| Secrets and credentials | `credentials/**`, `*.pem`, token files | configurable: allow / ask / deny | configurable: allow / ask |
| Deployment and runtime config | deployment files, runtime config files | configurable: allow / ask / deny | configurable: allow / ask plus built-in runtime config confirmation |
| Generated and dependency dirs | `node_modules/**`, generated output, build dirs | usually allow | configurable: allow / ask |
| Dangerous commands | destructive shell commands | n/a | configurable: allow / ask / deny plus default deny for unmatched commands |

Each guarded operation has one clear decision:

- `allow`: run normally.
- `ask`: create an Access request card so a human can allow this specific access.
- `deny`: block without creating a request.

## What It Does Not Control

Access does not try to list or approve every possible AI business action.

It should not gate ordinary employee work such as creating a Channel, drafting an article, organizing a launch room, or continuing a WorkRun. Those are guided by employee role, prompt, and normal tool behavior. Access only steps in when an existing tool call touches a sensitive path, credential-like resource, runtime config, or dangerous command. It does not guarantee coverage for every unknown future workflow.

Model-visible tools still need a declared execution boundary. TinyOffice separates low-level guarded tools, TinyOffice business capability tools, runtime protocol tools, read-only memory tools, and network tools. Only the low-level filesystem and shell boundary belongs to Access. Business capability behavior should stay governed by the registered capability registry and scene rules; future network policy should be handled as its own boundary rather than folded into file/path Access.

## Adding Resources

To put a resource under Access, add its file name or path pattern to the matching group. Each saved pattern keeps its own read and write rule; the group does not collapse mixed rules into one shared setting. Examples:

```text
.env
.env.*
credentials/**
customer-exports/**
*.pem
```

The new-pattern controls only set the initial rule for a new row. Existing rows remain explicit: for example, one Secrets row can be `blocked read / write allow` while another remains `sensitive read / protected write`.

Path writes currently support allow or ask; read rules and command rules support allow, ask, and deny. Full policy JSON stays under Advanced details for unusual cases that the row editor does not cover.

## Runtime Behavior

When an employee tries an operation classified as `ask`, the tool layer creates or reuses a pending Access request and blocks the attempted tool call. If the request belongs to a foreground Chat room, the approver handles it in that same Chat room through an inline Access card. If approved, TinyOffice creates a scoped grant for the original employee and context, then posts a decision notice in the original room so the employee can retry the same sensitive access through the original tool path and continue with the normal scene reply.

The guard covers structured read/write tools and known bash command risks. Bash remains a flexible shell tool, so Access treats sensitive path mentions in bash commands as guarded reads, but this is still a guardrail rather than OS-level isolation.

Runtime must not use the approval decision to perform unrelated business continuation by itself.

`Allow once` is consumed by the first matching retry. `Allow in this conversation` remains valid for the same member, resource, and conversation context. `Reject` does not create a grant.

## Storage

Current Access policy truth lives in PostgreSQL `tool_safety_policies`.

## Entrypoints

| Type | Entrypoint | Purpose |
| --- | --- | --- |
| shadcn app | Chat room foreground card | Review and resolve Access requests raised by that Chat room. |
| shadcn app | `Access` in the Developer tools menu | Developer-mode page for editing the company guard policy. It is hidden by default and is not the primary request-approval surface. |
| Company API | `/api/companies/:companyId/access` | Read and save the company-scoped Access policy through the TinyOffice-owned company API. |
| Company API | `/api/companies/:companyId/access/preview` | Technical helper for checking one read, write, or command decision. It is not a user-facing workflow. |
| Company API | `/api/companies/:companyId/access/requests` | List pending and resolved Access requests. |
| Company API | `/api/companies/:companyId/access/requests/:approvalId/resolve` | Resolve a foreground request as allow once, allow in this conversation, or reject. |
| Company API | `/api/companies/:companyId/access/tool-call` | Runtime bridge used by the PI guard for ask decisions. |

## Technical Docs

Technical implementation: [Access technical implementation](../technical/tool-safety.md).

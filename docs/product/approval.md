# Access Requests

An **Access request** asks a human whether to allow one specific sensitive resource or high-risk command access.

## Use

Access requests are for:

- reading or writing sensitive files
- using credentials or secret-like resources
- changing runtime or deployment configuration
- running commands that policy marks as high risk

They are not for ordinary business actions such as creating a channel, writing an article, or organizing work inside the employee's role.

## Foreground Card

Access requests raised by a Chat room are handled in that same room. When a WorkRun raises an Access request, its grant remains scoped to the WorkRun while the foreground card appears in the linked blocked-recovery direct message between the employee and requester. The Access policy page can still configure policy and preview decisions, but it must not be the only place to approve a request that interrupted foreground work.

The foreground Access card shows:

- requested access/action
- target resource
- company member requesting access
- reason
- optional approver decision note
- three actions: allow once, allow in the current conversation or WorkRun, and reject

An approver can allow a request once, allow it within the current conversation context, or reject it. Allow-once is the fast path and does not require a note. Allow-in-context and reject expose an optional note so the approver can add guardrails or tell the employee how to proceed. The note is persisted on the decision and shown in the resolved card and decision notice.

## Lifecycle

```text
member-backed employee runtime calls a tool
-> Access policy returns ask
-> Runtime creates an Access request card
-> approver approves or rejects, optionally with a note
-> approved request creates a scoped grant
-> Chat posts a decision notice in the owning foreground conversation
-> original member/session retries through the original tool path
-> runtime sends the normal final reply for that scene
```

Runtime must not use the card approval to directly perform the business task itself. The original member-backed runtime continues through the original action path. For a blocked WorkRun, the decision notice in the recovery conversation resumes the original WorkRun session, where the employee retries through the granted tool path.

## Decision Scope

Access request v1 supports only scoped runtime grants:

| Decision | Grant scope | Use |
| --- | --- | --- |
| Allow once | `one_time` | Let the original employee retry one matching access. |
| Allow in this conversation | `session` | Let the original employee keep using the same resource in the current foreground context. |
| Reject | none | Block the request and optionally give guidance. |

Role-wide, employee-wide, company-wide, and pattern-wide approvals are not Access request actions. Those are Access policy changes and belong on the Access policy surface.

## Data Model

`Approval` and `ApprovalGrant` are the storage mechanism for Access requests and grants.

| Field | Meaning |
| --- | --- |
| `contextKind` / `contextId` | Original session or work context. |
| `requestedByMemberId` | Company Member who needed access. |
| `requestedApproverMemberId` | Optional suggested approver. |
| `requestedAction` | Access action, such as file read, file write, credential use, or command execution. |
| `requestedResource` | Resource being accessed. |
| `requestedInputSnapshot` | Optional structured snapshot for audit. |
| `decisionNote` | Optional approver note. |
| `ApprovalGrant.memberId` | Temporary permission for the approved member and access. |

## Related Pages

- [Access](tool-safety.md)
- [Work actions and Access boundaries](work-actions-and-approvals.md)

# Product Closure Audit

This matrix records the cross-module closure baseline established during the final private-incubation audit. It focuses on product truth crossing module boundaries rather than page-level appearance.

| Flow | Authoritative rule | Status | Evidence |
| --- | --- | --- | --- |
| Employee deactivation -> active discovery | Inactive runtime profiles are excluded from the frontend directory and AI-callable member directory. | Closed | `company-directory-repository`, member directory and lifecycle tests |
| Employee deactivation -> new Chat / Channel work | Inactive members cannot be new DM targets, mentions, retries, or Channel additions. | Closed | Chat entry, dispatch, and Channel action boundary tests |
| Employee deactivation -> historical Channel identity | Membership and messages remain; current name, avatar, and role come from `company_members`; runtime actions stay disabled. | Closed in #991 | PostgreSQL Channel repository and Chat shell model tests |
| Employee deactivation -> Tasks | Existing Tasks remain readable with current owner identity; immediate, scheduled, and retry execution revalidate active assignees. | Closed in #991 | Tasks loader/view-model tests and Work lifecycle tests |
| Employee deactivation -> Sessions | Existing Sessions remain readable and resolve the current Company member name and role. | Closed in #991 | Session Explorer database test |
| Company switching and deletion | Company-scoped session, member, Chat, Work, and configuration reads use the selected Company; deletion follows the explicit lifecycle boundary. | Closed | Company admin, current-session, and API tests |
| Runtime model catalog updates | Available models come from the installed PI registry; Update Center compares installed, upstream, and approved versions rather than hand-writing model ids. | Closed | Runtime model and TinyOffice Update service tests |
| Access and tool execution | Tool execution passes through the Company/runtime permission boundary and records evidence; UI state is not authority. | Closed | Access and tool-execution architecture tests |
| Channel dissolve -> Access | Pending Topic requests are canceled and Topic-scoped grants are removed before Topic conversations disappear. | Closed in #993 | Channel dissolve PostgreSQL integration test |
| Channel dissolve -> attachments | Attachment rows and files are deleted only when no surviving Message references them; shared attachments remain. | Closed in #993 | Channel dissolve PostgreSQL integration test |
| Attachment upload -> Message / discard | Message writes durable attachment references transactionally; uploader discard and stale cleanup can remove only unreferenced uploads. | Closed in #995 | Attachment lifecycle PostgreSQL/filesystem integration test |
| Attachment content read -> Chat visibility | Unreferenced uploads are readable only by their uploader; referenced attachments require participation in at least one referencing Conversation and unauthorized reads do not disclose existence. | Closed in #997 | Attachment API authorization tests and PostgreSQL reference-chain integration test |

## Regression Standard

Every lifecycle change must be checked in two directions:

1. **Future capability:** discovery, selection, assignment, dispatch, write, and retry must reflect the current lifecycle and permission truth.
2. **Historical readability:** Chat, Tasks, Sessions, traces, and audit evidence must remain readable with authoritative member identity and without regaining execution capability.

Do not repair a failed row by adding a page-local fallback. Fix the storage join, service rule, or backend projection that supplies all consumers, then add a regression test at that boundary.

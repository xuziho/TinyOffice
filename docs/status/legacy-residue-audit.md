# Legacy Residue Audit

This page records the current TinyOffice boundary after hard-delete passes for legacy Console, Mattermost identity, root-post carrier residue, and preview default identity residue.

Last audit snapshot: 2026-06-29, updated for Issue #866.

## Final Boundary

Current product code must use TinyOffice-owned ids and company-scoped APIs:

- `companyId`
- `memberId`
- `employeeId`
- `conversationId`
- `roomId`
- `chatEntryId`
- `messageId`
- `sessionId`
- `workTaskId`
- `workRunId`
- `processTraceId`

Current product/admin behavior must not expose or preserve these retired identities:

- native HTML Console product pages
- `/console/...`
- `/api/console/...`
- `company_mattermost_bindings`
- `employee_mattermost_accounts`
- `mattermost_login_id`
- `mattermostAccount`
- `rootPostId`
- `legacyRootPostId`
- `sourceRootPostId`
- `legacyCarrier`
- `routesThroughMattermostPosts`
- root-post or Mattermost-thread identity semantics
- implicit preview Company/user/target employee defaults
- `TINYOFFICE_PREVIEW_MEMBER_ID`
- `TINYOFFICE_PREVIEW_TARGET_EMPLOYEE_ID`

## Latest Hard Delete

Issue #866 removed the remaining legacy contract residue recorded after #864:

- Work code and Process Trace now use the canonical WorkTask / `workTaskId` contract without WorkPlan aliases.
- `channel_topic_handoffs.outcome` is removed from the current schema and dropped by migration.
- Chat, intake, and WorkRun final-output contracts reject retired broad approval result fields; Access remains the approval boundary for sensitive resources.

Issue #864 removed the real runtime preview defaults for:

- default Company `tinyoffice`
- default preview user/member `xuziho`
- default preview display name `Xu Ziho`
- default target employee `nora-automation`

`scripts/runtime/run-real-chat-preview.ts` now requires `TINYOFFICE_PREVIEW_USER_ID`. `TINYOFFICE_PREVIEW_COMPANY_ID` is optional and only selects an active Company when the operator explicitly provides it. Without a selected Company, preview startup keeps the first-create Company flow visible instead of pretending a default Company exists.

## Remaining Setup Gates

Current product code must not expose the retired contracts above. TinyOffice now uses a pre-release PostgreSQL baseline instead of preserving destructive historical migration guards for local test data. The only non-archive source-code mentions allowed after Issue #866 are explicit setup/reset gates, negative tests that prove retired final-output fields fail, and Access/governance approval policy names that are not scene-result contracts.

## Allowed Remaining Mentions

Only these references are acceptable in the current repository:

- explicit pre-release PostgreSQL reset/setup gates
- negative guard tests that assert carrier fields and routes do not return
- archived docs under `docs/archive/`
- retired material that is clearly not product truth

## Review Commands

```powershell
rg -n "rootPostId|legacyRootPostId|sourceRootPostId|legacyCarrier|routesThroughMattermostPosts" src apps tests docs --glob "!docs/archive/**"
rg -n "company_mattermost_bindings|employee_mattermost_accounts|mattermost_login_id|mattermostAccount" src apps tests docs --glob "!docs/archive/**"
rg -n "/console|/api/console|native compatibility|transitional console" src apps tests docs --glob "!docs/archive/**"
rg -n "WorkPlan|workPlanId|work_plan_id|channel_topic_handoffs\\.outcome|outcome text" src tests scripts docs --glob "!docs/archive/**"
rg -n "mattermost|root_post_id|work_plan" src tests scripts docs --glob "!docs/archive/**"
```

Expected results are limited to the allowed categories above.

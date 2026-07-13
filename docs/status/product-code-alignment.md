# Product Code Alignment

This page records current alignment between the product manual and implementation.

## Current Frontend Direction

The documented frontend implementation target is `apps/tinyoffice-web-shadcn`.

New frontend work must use TinyOffice-owned APIs, the frontend-safe contract entry `tinyoffice/frontend-api-contracts`, and shadcn primitives or approved registry components.

## Current Chat / Message Foundation

Current Chat, Conversation, and Message work belongs to:

- `src/collaboration`
- `src/api/contracts/tinyoffice-frontend-api-contracts.ts`
- `apps/tinyoffice-web-shadcn/src/api`
- `apps/tinyoffice-web-shadcn/src/chat`
- `apps/tinyoffice-web-shadcn/src/app/App.tsx`

The frontend must not derive product state from retired carrier ids, plugin routes, or deleted UI entrypoints.

## Alignment Method

1. Add or update the stable product page when a product decision changes.
2. Add or update the technical page when implementation boundaries change.
3. Keep status pages factual and short.
4. If code and docs disagree, say which one is stale and update the stale side in the same slice when practical.

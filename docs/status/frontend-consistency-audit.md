# Frontend Consistency Audit

This audit is the closeout record for the shared Soft Neo-Retro visual and interaction layer in `apps/tinyoffice-web-shadcn`.

## Scope

The 2026-07-12 audit captured the live `5175` preview at a 1280 by 720 desktop viewport after route data had settled. It covered:

1. Chat
2. Tasks
3. Sessions
4. Employees
5. Organization
6. Company Skills
7. Integrations
8. Prompt Policy
9. System AI
10. Access
11. Capabilities
12. Doctor
13. Backup & Restore
14. Settings

The capture set is a current-run verification artifact, not a second design source of truth. Product behavior remains defined by the product manual and frontend contracts.

## Confirmed shared contracts

- Every route uses the 60px product rail, warm canvas, product header, and shared semantic tokens.
- Principal, secondary, quiet, disabled, and destructive actions are supplied by shared shadcn button roles.
- Selection directories use the shared `SelectionList` / `SelectionRow` treatment.
- Tables, tabs, filter chips, dropdowns, dialogs, semantic status surfaces, avatars, and scrollbars use shared product rules.
- Native file inputs are visually hidden behind labelled shadcn actions.
- Native disclosure summaries and ordinary text links receive shared hover and keyboard focus feedback.
- Reduced-motion preferences suppress decorative interaction timing without changing product behavior.

## Automated guard

`src/app/frontendConsistency.test.ts` prevents product pages from reintroducing visible native button, select, textarea, or file-input styling and verifies that the shared stylesheet still covers the required interaction and semantic roles.

This guard does not claim complete accessibility conformance. Browser screenshots cannot prove screen-reader announcements, full keyboard order, zoom reflow, or every transient API state. Those remain part of focused workflow testing when a route changes.

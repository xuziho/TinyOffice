# TinyOffice Design System

The current product-facing frontend foundation source of truth is [Frontend UI Foundation](product/frontend-ui-foundation.md). The product-facing style source of truth is [TinyOffice UI Style Brief](product/ui-style-brief.md).

## Current Direction

TinyOffice UI should be:

- quiet
- dense
- clear
- restrained
- workbench-like
- state-first
- theme-ready through semantic tokens

It should not be a marketing page, decorative dashboard, copied chat shell, or one-off collection of page-specific styles.

## Current Frontend Boundary

TinyOffice has decided to rebuild the standalone frontend on `shadcn/ui`.

New frontend work belongs in the shadcn app:

```text
apps/tinyoffice-web-shadcn
```

Do not import or reuse the existing local UI primitives, old `ui-*` CSS classes, `AdminShell`, `Panel`, `StateBlock`, or page-specific CSS in the shadcn rebuild.

## UI Foundation Rule

Base UI primitives must come from `shadcn/ui` through the official shadcn CLI or an approved registry. Use shadcn MCP/registry lookup before adding or designing UI.

Do not hand-roll replacement primitives such as buttons, dialogs, dropdowns, inputs, selects, tables, scroll areas, sidebars, sheets, tooltips, message rows, message bubbles, or attachment cards.

Allowed custom components are TinyOffice product composition components only, such as:

```text
WorkspaceShell
ChatSidebar
RoomView
Composer
ContextPanel
TaskPanel
SessionEvidencePanel
ConfigSection
```

These product components must compose shadcn primitives rather than recreate base UI behavior.

## Blocks Rule

Prefer official shadcn components and app/workspace/admin/chat blocks. Do not use marketing, landing-page, pricing, hero, testimonial, decorative dashboard, or gradient-heavy blocks for TinyOffice product surfaces.

TinyOffice is a Slack/Discord-like collaboration workspace plus operations/admin surfaces, not a marketing site or single-thread ChatGPT clone.

## Required Reading For UI Work

Before changing frontend UI structure, read:

- [Frontend UI Foundation](product/frontend-ui-foundation.md)
- [TinyOffice UI Style Brief](product/ui-style-brief.md)
- [AI Assisted UI Design Principles](ai-assisted-ui-design-principles.md)
- the relevant product model page
- for the shadcn rebuild, official shadcn component or block documentation for the target surface

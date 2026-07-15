# TinyOffice UI Style Brief

This brief is the product-facing style memory for the standalone TinyOffice frontend. The foundation decision lives in [Frontend UI Foundation](frontend-ui-foundation.md).

Product-level logo, palette, lockup, and Company-branding boundaries live in [Brand Identity](brand-identity.md).

TinyOffice uses `shadcn/ui` as the standalone frontend foundation. New frontend UI work belongs in `apps/tinyoffice-web-shadcn` and should not extend retired local primitive layers.

## Default Direction

The default TinyOffice visual direction is a Soft Neo-Retro operations workbench: dense and readable, warm paper surfaces, confident ink-like boundaries, compact icon-first navigation, restrained pastel accents, and state-first product hierarchy. It should feel witty and approachable without becoming a toy, children's planner, or decorative dashboard.

TinyOffice UI should feel like an operations workbench for repeated company work. It should favor scannable lists, compact controls, direct state labels, readable evidence, and small semantic emphasis. It should not feel like a marketing site, decorative dashboard, copied chat shell, or template demo.

The product rail uses spatial priority without visible category headings. Chat and Tasks are the only upper daily-work destinations. The lower group contains Workforce and Admin, followed by Settings. Workforce groups Employees and Company Skills. Admin uses visible menu headings to group Company destinations (Organization and Integrations), AI & Runtime destinations (System AI, Prompt, Access, and Capabilities), and System destinations (Sessions, Health, and Backup & Restore). Grouping changes navigation only: the existing pages, routes, fields, and workflows keep their own product structures.

## Soft Neo-Retro Chat Language

The selected Chat visual benchmark is [`docs/assets/soft-neo-retro-chat-reference.png`](../assets/soft-neo-retro-chat-reference.png). It is a visual reference, not a second product source of truth. Production behavior, data shape, and navigation still live in the product docs and frontend contracts.

Use shadcn primitives for base behavior and accessibility. TinyOffice-specific visual personality should live in product composition components and shared `tiny-*` classes, not in one-off page-local Tailwind chains.

Core visual rules:

| Area | Rule |
| --- | --- |
| Shell | Keep a 60px icon rail, a quiet workspace sidebar, a broad centered work surface, and a narrow context/evidence panel. |
| Color | Use warm paper neutrals, black primary marks, and restrained cyan, pink, yellow, lavender, and mint accents. Employee avatars keep the upstream Adventurer Neutral defaults because they occupy a small identity surface. |
| Typography | Prefer small operational sizes: 12px labels, 13px metadata, 14px secondary text, 15-16px primary body text, and 18px room titles. Do not scale type with viewport width. |
| Density | Lists should be compact and scannable. Controls should be visible through placement and hover state, not decorative chrome. |
| Chat messages | User messages align right with a light cyan filled bubble. AI employee messages align left in a warm framed surface so long operational replies remain visually grouped. |
| Activity | Runtime Activity belongs in the right context panel for selected topics. List views must not show raw process trace or runtime sessions. |
| Topic lists | Topic list rows use the entry title plus a compact preview from the first message body, with right-aligned time metadata. Rows are ordered oldest-to-newest so the latest topic and Start new topic action sit at the bottom; list views should open at the bottom. Do not reuse the generated title as the preview. Archived topics should disappear from the normal list when that product model exists. The archived-list entry is a quiet icon without a count badge in normal mode, and only becomes a labeled return control inside the archived view. |
| Chat responsive layout | Keep the 274px Chat directory stable while the right Context column scales between 248px and 320px. Preserve the center conversation as the priority surface. Room-level back navigation belongs before the title. Secondary metadata remains quiet but must retain readable contrast. |
| Composer | Composer is centered, slightly roomy, icon-first, and keeps send/stop as icon buttons with accessible labels. |

Chat density should preserve a broad readable stream without letting the Composer dominate short desktop viewports. The default Soft Neo-Retro target uses 14px message-row spacing, 10px by 13px message-body padding, a 60px minimum Composer input, 28px supporting tools, a 32px send/stop control, and 44px message-stream employee avatars. Sidebar employee avatars stay compact. Channel rows use a plain hash because the selected row already carries the navigation frame.

Conditional Chat overlays share one product treatment even though their behavior remains built from shadcn primitives. Mention pickers, Create Channel, Edit Topic Title, Channel Settings, and destructive confirmations use warm paper surfaces, ink boundaries, compact rows, and restrained pastel emphasis. Access approval stays semantically yellow and uses mint only for the positive approval command; it must remain distinguishable from an ordinary Chat card.

When adding Company, Employee, Task, Session, Prompt, or Access pages, reuse the same shell/sidebar/context/composer/list/token language first. Add new product components only when the workflow needs a new pattern.

## Tasks Visual Language

Tasks uses the same Soft Neo-Retro shell and semantic tokens as Chat. The selected Tasks prototype is a visual composition reference only: it must not replace the authoritative Task lifecycle, list grouping, filters, fields, routes, actions, or runtime contracts.

The Tasks surface keeps the current Current, Scheduled, and History views; the Task, State, Owner, Next action, and Updated list projection; and the existing Needs attention / Up next grouping. Visual treatment may strengthen hierarchy through warm-paper surfaces, ink boundaries, restrained offset shadows, employee avatars, semantic status pills, and a prominent attention area, but real counts and visible items must agree.

Visual migration applies to the complete Tasks page family rather than only the populated list. The shared treatment covers the global rail, list, attention items, filters, first-empty state, filtered and scheduled empty states, loading, errors, detail evidence, lifecycle actions, run actions, and confirmation dialogs. No Tasks state should fall back to an unstyled default shadcn appearance.

## Shared Product Surface Language

All standalone product routes use the same Soft Neo-Retro shell as Chat and Tasks. The shared layer owns the Company mark, rail active/open states, warm-paper page background, product headers, ink boundaries, restrained offset shadows, compact operational typography, semantic accents, form controls, tabs, tables, dialogs, dropdown menus, and primary/quiet/destructive action roles.

Shared visual treatment does not make every page structurally identical. Workforce, AI & Runtime, and Operations share page-level sibling navigation, while their pages keep separate routes and workflows. Sessions remains an evidence inspector; Employees and Company Skills remain configuration workspaces; Integrations remains an intake setup surface; System AI, Prompt, Access, Capabilities, and Health retain their technical workflows; Settings owns personal profile and security; Backup and Updates retain independent operational scope. The shared layer must never replace a route's fields, grouping, permissions, filters, actions, or runtime behavior.

Every page family must cover populated, empty, loading, error, success, disabled, menu, dialog, and destructive states that its real workflow exposes. New product pages should enter through the shared Soft Neo-Retro shell and semantic component roles rather than adding a page-local visual theme.

### Visual Hierarchy Contract

Reusing the same border, radius, and paper color is not enough to make a page part of the shared theme. Every product surface must express a stable hierarchy through a small set of semantic surface roles. Pages choose these roles by meaning instead of inventing a new card treatment.

| Role | Visual treatment | Product meaning |
| --- | --- | --- |
| Canvas | Warm ivory, without frame or shadow. | The route-level workspace behind all content. |
| Primary surface | Near-white warm paper, optional strong frame, restrained offset shadow only when the whole region is raised. | The main working or reading region for the current task. |
| Quiet surface | Deeper warm beige, faint divider or no border. | Secondary explanation, filters, metadata, read-only facts, and inset evidence. |
| Interactive surface | Warm paper at rest, visible hover and focus feedback, cyan only while selected. | Rows, choices, and controls the user can act on. |
| Semantic surface | Tinted yellow, mint, pink/red, or cyan plus icon and text label. | Warning, success, danger, or informational state. Color never carries the state alone. |

Use one visually dominant surface per local workflow. A primary surface may contain quiet regions, rows, and dividers, but it must not contain a stack of equally framed cards. Nested content should normally lose one of border, shadow, or contrasting fill; it must not repeat all three levels of emphasis from its parent.

The default depth order is warm ivory canvas, near-white primary working surface, warm beige quiet or inset region, then semantic or selected emphasis only where meaning requires it. Typography and spacing establish the first reading order. Surface color confirms grouping. Borders define boundaries only when the boundary matters for interaction, scrolling, elevation, or data comparison. Color must not be added only to make an otherwise flat page look decorated.

### Accent Responsibilities

Pastel accents have fixed responsibilities across pages, dialogs, menus, and responsive states:

| Accent | Responsibility |
| --- | --- |
| Cyan | Current selection, focused information, running state, and navigational emphasis. |
| Pink | Principal command and deliberate destructive emphasis when danger red would be unnecessarily harsh. |
| Yellow | Attention, compatibility concern, blocked work, and recoverable warning. |
| Mint | Verified, completed, healthy, approved, and successful outcome. |
| Red | Destructive actions, failed states, irreversible deletion, and lifecycle deactivation. Default danger controls use dark red with white text; hover compresses to a lighter red with dark-red text. |
| Lavender | Rare neutral categorization or supporting identity; never a primary action or lifecycle state. |

Large decorative accent panels are not allowed. A page should normally expose one principal accent at a time, with additional semantic colors appearing only for real concurrent states.

### Page Composition Rules

- Summary or status areas may use one soft semantic band when they answer the page's primary question, such as whether updates are available or a backup is healthy.
- Metric or version comparisons belong in one grouped comparison strip or table. Do not make every value a separate raised card.
- Forms use one working surface with field groups separated by spacing, headings, or quiet inset regions. Do not frame every field group as an independent card.
- Empty and no-change states are quiet content inside their owning region. They do not receive a large standalone frame unless they are the page's only meaningful content.
- Read-only values use a quiet surface or plain fact rows and must not look like editable inputs.
- Tables use a raised outer data surface, a warm-beige header, quiet row dividers, and row hover. Cells do not become cards.
- Selection lists use cyan only for the selected row. Hover uses warm beige and must not visually compete with selection.
- Dialogs use one raised warm-paper window. Their header, body, optional quiet information region, and footer are separated by spacing or a faint divider; forms inside dialogs do not add a second dialog-like frame.
- Warnings, errors, and success notices use the shared semantic surface roles. Page-local color utility combinations and raw white are not substitutes for the shared roles.

### Action Hierarchy

Every action has one explicit role:

- **Principal:** pink filled control with ink boundary and restrained offset shadow; normally one per local workflow or dialog.
- **Secondary:** near-white warm-paper control with an ink boundary and clear hover compression or fill change.
- **Quiet:** borderless or faintly framed control for low-risk navigation, disclosure, or utility action.
- **Semantic:** warning or destructive treatment used only when the action changes lifecycle, removes data, or resolves a risky state.
- **Disabled:** quiet beige with no elevation; disabled controls must not look editable or active.

All action roles share cursor, hover, active, focus-visible, disabled, and reduced-motion behavior through shadcn primitives and shared theme rules. A page must not recreate these states locally.

Controls are unified by meaning rather than by putting the same border around everything:

- **Segmented controls** switch between mutually exclusive peer views, such as Active / Inactive or Current / Scheduled / History. The group has one shared frame and the selected segment uses cyan emphasis.
- **Content tabs** navigate sections inside one object, such as Profile / Runtime / AGENTS.md / Skills / Assets. They use a quiet baseline and active underline instead of another boxed control.
- **Filter chips** refine a result set. Inactive chips are quiet and mostly borderless; selected chips use cyan emphasis. A row of filters must not read as a row of primary buttons.
- **Selects, dropdown menus, and popovers** use the same warm-paper, ink-boundary treatment in both closed and portal-rendered open states. Highlight, selected, disabled, and checked states remain visibly distinct.
- **Actions** keep explicit roles: pink for the principal command, warm-paper for quiet commands, semantic warning/destructive color where the workflow requires it, and icon-only treatment only when the icon has an accessible name.

Product surfaces use warm-paper depth instead of raw white: the page canvas is warm ivory, primary reading surfaces use a near-white warm paper, and inset or disclosure regions use a slightly deeper beige. Pure white must not reappear as a page-local escape hatch. Pastel accents remain semantic rather than becoming large decorative fills.

Disclosure rows communicate expansion through their chevron, whole-row hover treatment, and visible content state. Do not add redundant visible phrases such as `Open activity`, `Open prompt input`, or `Open tools and skills`. Lifecycle state badges, neutral model labels, and non-interactive evidence counts must remain visually distinct: state uses semantic color, model labels stay quiet, and counts use compact icon-led markers rather than button-like outline pills.

Left-rail object navigation uses one `SelectionList` / `SelectionRow` language across Capabilities, Access, Prompt Policy, Company Skills, Employees, and future configuration directories. A normal row is quiet and borderless; hover adds a warm-paper surface; selection uses a persistent cyan fill, ink boundary, left marker, and restrained offset shadow; keyboard focus remains explicit; pressed and disabled states are shared. Data tables and disclosure lists remain separate component families and must not be forced into the selection-row pattern.

Native scrollbars and shadcn scroll regions use a restrained product treatment: thin warm-beige tracks, muted ink-beige thumbs, rounded ends, and cyan hover feedback. Scrollbar styling must not reduce hit area below a practical desktop size, hide overflow, or change scrolling behavior.

## Interaction Stability

User-initiated local interactions must preserve the product shell and active workspace. A local interaction can update the controls and content it directly affects, but it must not make unrelated rail, header, module, or context regions visibly flash, collapse, remount, or look like a page reload.

For Chat, sending a message or starting the first Topic / DM chat may update the composer, message stream, processing presence, room metadata, and relevant unread or mention counters. It must not remount or visibly flash the full Chat shell, top product rail, module header, left Chat list, or unrelated right Context frame. Full-page skeletons are for first load or route-level absence of data, not for ordinary message send, room refresh, or realtime reconciliation.

Streaming employee replies and their persisted final messages must use the same message-row geometry from the first visible token: avatar alignment, content width, outer frame, padding, and spacing stay stable. Completion may replace the temporary `writing` metadata with final timestamp and usage evidence, but it must not move the avatar or introduce a new message frame.

The streaming-to-persisted handoff must reconcile as one stable message row and one scroll anchor. The UI must never remove the draft before the authoritative Message is available, render the draft and persisted reply at the same time, or replace the row with a different list identity during completion.

Selecting an employee Message as the source for the right-side Activity panel must not add a persistent outer frame or background around the already-framed Message body. The Activity header carries the selected identity; Chat keeps only a quiet hover affordance and a borderless keyboard-focus tint.

## Avoid

Avoid large gradients, decorative blobs, large rounded cards, heavy soft shadows, excessive whitespace, marketing hero layouts, one-off styling per page, childish stationery styling, and copied native-chat-shell styling.

## Employee Avatar Direction

Runtime-capable employees and human users use DiceBear `Adventurer Neutral` generated locally from an authoritative persisted `avatarSeed`. The default upstream colors and expression distribution remain intact. Existing identities are migrated with their immutable id as the initial seed, preserving the avatar they had before avatar editing shipped.

Employee Profile and Settings > My Profile expose a shared avatar editor. “Generate another” changes only the local draft; the new seed becomes authoritative only through the page's explicit save action. Employee seeds live with the Company member identity, while the human user's seed lives with the account profile and synchronizes to that user's Company member identities. Avatar changes must flow through this persisted identity contract rather than display-name derivation or view-local randomness.

This does not ban all gradients or shadows. It means they must be small, functional, and tokenized. Skeleton loading may use a restrained tokenized gradient; panels may use a small tokenized shadow only when elevation communicates state.

## Semantic Token Taxonomy

Color tokens cover:

| Contract | Purpose |
| --- | --- |
| background/foreground | Page background and default text. |
| surface/surface-raised/surface-muted | Normal panels, raised controls, and quiet sidebar or inset regions. |
| border/border-strong | Default divider lines and stronger input/control boundaries. |
| muted/muted-foreground | Quiet fills and secondary text. |
| primary/primary-foreground | Primary command fill and text. |
| accent/accent-foreground | Selected navigation, active rows, and small emphasis. |
| danger/warning/success | Error, caution, and success states. |
| unread/mention/focus-ring | Conversation attention states and keyboard focus. |

Layout tokens cover app sidebar width, conversation sidebar width, right panel width, topbar height, list row height, and composer min height.

Base scales are:

| Scale | Values |
| --- | --- |
| spacing | 4/8/12/16/20/24/32 |
| radius | 4/6/8 |
| border | 1px |
| font | 12/13/14/16/18 |

## Theme-Ready Constraint

Do not implement a theme switcher now. Do not create multiple built-in themes now.

Components should consume shadcn CSS variables and semantic state tokens so a future theme replacement can change theme personality without rewriting product components. New shadcn page slices should avoid product color literals inside component rules.

Future theme variants should hang from selectors such as `[data-theme="..."]`; do not implement the switcher until the product needs it.

The current default token values preserve the existing quiet standalone shell direction. Future visual personality work should change token values first, then only adjust component structure when a real workflow needs it.

## shadcn Frontend Rebuild Direction

`shadcn/ui` is now the official frontend UI foundation for TinyOffice. Base primitives must be added through the official shadcn CLI or an approved registry, not recreated by hand.

Use official shadcn components and app/workspace/admin/chat blocks where they fit. Do not use marketing, landing-page, pricing, hero, testimonial, decorative dashboard, or gradient-heavy blocks for TinyOffice product surfaces.

Chat surfaces should prefer official shadcn chat primitives where applicable: `message-scroller`, `message`, `bubble`, `attachment`, and `marker`.

Retired local primitives such as `AdminShell`, page-specific primitive wrappers, and state blocks are not the frontend foundation.

Chat remains the primary product surface and must not be collapsed into generic admin tables or settings forms. TinyOffice should keep the Slack/Discord-like collaboration workbench structure: left workspace/channel/DM navigation, center room/message/composer surface, and right context/evidence panel.

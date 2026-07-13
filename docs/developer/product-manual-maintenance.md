# Product Manual Maintenance

TinyOffice uses `docs/` as the product manual and long-term product memory. The manual should describe current product truth, current implementation boundaries, and verification paths.

## Daily Workflow

- Edit Markdown source in `docs/`.
- Keep navigation in `mkdocs.yml` aligned with current pages.
- Use `npm run docs:build` after broad documentation edits.
- Use `npm run docs:sync-obsidian` when the Obsidian reading copy needs to be refreshed.
- Put temporary investigations, one-off audits, and draft plans in `.scratch/`, not in product docs.

## Current Product Docs Only

Product pages, technical pages, status pages, and runbooks should describe the current TinyOffice system.

When a feature is deleted, retired, or replaced:

- remove it from product pages, feature maps, status pages, technical pages, and navigation;
- remove links to retired pages from current docs;
- do not keep it as a reference, fallback, hidden entry, compatibility path, or future-maybe path;
- keep only current destructive reset notes, setup gates, or negative-test guidance when they are needed to protect the current system;
- if history must be retained, put it in `docs/archive/` and do not link it from current product pages.

## Frontend Documentation Rule

Current frontend documentation targets `apps/tinyoffice-web-shadcn`.

Do not document retired local UI primitives, old page shells, old CSS classes, deleted frontend modules, plugin UI entrypoints, or old app structure as current implementation guidance.

If a surface has not been rebuilt in the shadcn frontend yet, write `not rebuilt yet` and point to the current backend/API boundary instead of pointing at an old UI path.

## Page Responsibilities

Product pages should answer:

- What is this feature?
- Who uses it?
- Where does it appear?
- What can it do now?
- What are its boundaries?
- Which technical page owns the implementation details?

Technical pages should answer:

- What module owns this behavior?
- What API or view model does it expose?
- What data source does it use?
- What runtime events or state transitions matter?
- How is it verified?

Developer pages should answer:

- How do we run it?
- How do we test it?
- How do we debug it?
- What workflow rules must future agents follow?

Status pages should answer:

- What is currently true?
- What is implemented?
- What is not rebuilt yet?
- What must not be treated as product truth?

## Archive Rule

`docs/archive/` is for historical evidence only.

Archived pages are not current product truth, not implementation guidance, and not a source for future frontend work. If an archived conclusion becomes current again, rewrite the stable conclusion into the relevant current product or technical page.

## Build And Preview

```powershell
npm run docs:build
npm run docs:serve
npm run docs:sync-obsidian
```

MkDocs is a local build and preview tool. The Markdown files in `docs/` remain the source. Obsidian is a reading copy, not the editing source.

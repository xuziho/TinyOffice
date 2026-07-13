# Repository Boundaries

This page defines what belongs in the current TinyOffice repository after the retired carrier system was hard-deleted from mainline.

## Current Boundary

| Area | Location | Role | In this repository |
| --- | --- | --- | --- |
| TinyOffice product system | Current repository root | Product code, product docs, TinyOffice-owned frontend/API/runtime/work/governance/storage logic. | Yes |
| TinyOffice standalone frontend | `apps/tinyoffice-web-shadcn` | Product Chat, Tasks, Sessions, Trace, and configuration surfaces. | Yes |
| TinyOffice runtime/API | `src/`, `scripts/runtime/` | Hono/API routes, Chat dispatch, runtime provider adapters, realtime events, PostgreSQL repositories. | Yes |
| Product manual | `docs/` | Current product intent, architecture, runbooks, and verification truth. | Yes |
| Runtime data | PostgreSQL, Docker volumes, logs, uploads, generated local files | Mutable local/runtime state. | No |

## Mattermost Rule

The current repository must not keep Mattermost plugin code, Mattermost Docker deployment files, Mattermost runtime adapter scripts, or Mattermost native frontend entrypoints as runnable mainline paths.

## AI Collaboration Rule

Before changing code, classify the work:

- TinyOffice product/runtime/frontend/API/docs: work in this repository.
- Runtime data and local deployment state: do not commit.

Do not copy Mattermost Team/User/Channel/Post APIs, plugin routes, root components, post renderers, adapter scripts, or runtime adapter code back into this repository.

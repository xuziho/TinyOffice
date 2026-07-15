# Interface localization

TinyOffice supports an English and Simplified Chinese product interface. Localization is an Owner-level display preference, not an AI runtime instruction.

## Locale ownership

- `uiLocale` is stored on the Owner profile and accepts `system`, `en`, or `zh-CN`.
- `system` follows the browser or operating-system language and resolves Chinese locales to `zh-CN`; all other locales resolve to English.
- The selected locale applies across Companies because the Owner profile is shared across Companies.
- Changing the interface locale must not change an employee's preferred response language, prompts, session history, or generated content.

## What is translated

Translate product-owned interface chrome: navigation, buttons, form labels, empty states, status labels, accessibility labels, confirmations, and known product errors. Dates and times use the active UI locale.

Do not translate identity-bearing or user-authored content:

- Company, channel, Topic, Task, employee, and Skill names
- messages, Task objectives, Prompt Policy content, `AGENTS.md`, and `SKILL.md`
- model/provider identifiers, member IDs, paths, command patterns, and API fields
- raw runtime evidence and unknown server or provider diagnostics

Structured enums keep stable values in contracts and storage. The frontend localizes only their display labels.

## Fallback behavior

English is the fallback resource language. Unknown backend diagnostics remain intact rather than being guessed or rewritten. A localized product summary may be shown alongside raw detail when a stable error code exists.

## Implementation map

- Resources: `apps/tinyoffice-web-shadcn/src/i18n/resources.ts`
- Locale initialization: `apps/tinyoffice-web-shadcn/src/i18n/index.ts`
- Owner preference: `user_profiles.ui_locale`
- Profile API contract: `UserProfileState.uiLocale`

The maintained coverage includes the shared shell, Chat and Task operations, Workforce and Company configuration, AI and Runtime administration, Operations pages, dialogs, empty/loading/error states, and accessibility labels. Resource-parity and static-key tests prevent one language from silently losing a key, while a hard-coded chrome regression test protects the migrated product surfaces.

New product copy must be added through the localization resources rather than embedded as parallel English and Chinese conditionals in a page.

# Product Acceptance Pass — 2026-07-13

This pass checks the merged `main` product through the live standalone frontend and runtime stack. It records reproducible product evidence rather than treating visual polish or speculative completeness as a defect.

## Environment

- Frontend: `http://127.0.0.1:5175`
- Runtime API: `http://127.0.0.1:8095`
- PostgreSQL: port `55432`
- Current user: `Xuziho`
- Current Company: `ziho-e-com`

## Verified Surfaces

| Flow or surface | Result | Evidence |
| --- | --- | --- |
| Workspace load and Company context | Pass | Chat resolves Ziho E-com, Xuziho, Channels, Direct Messages, entries, participants, and current avatars after initial loading. |
| Primary navigation | Pass | Chat, Tasks, Sessions, Employees, Access, Organization, Settings, Doctor, and Backup & Restore load through the product navigation without browser errors. |
| Organization route | Pass | The formal Manage -> Organization navigation resolves `/company`; `/organization` is not the product route. |
| Tasks empty state | Pass | Current, Scheduled, and History resolve with zero items and no loading or error state. |
| Sessions list and detail | Pass | Filters, session rows, per-turn evidence, model, token totals, Prompt Input, Activity, and related-Chat affordance resolve from live runtime evidence. |
| Employee configuration | Pass for read path | Active/inactive counts, employee selection, profile fields, avatar, tabs, and save/deactivate affordances resolve. No lifecycle mutation was performed in this read-only pass. |
| Access | Pass for read path | Current policy categories and decisions resolve without browser errors. No policy mutation was performed. |
| Organization and branding | Pass for read path | Company list, current Company identity, branding upload affordance, and guarded deletion surface resolve. No Company mutation was performed. |
| Doctor | Pass for page operation | Diagnostics load with Company, Employees, Runtime, and Access checks. Cross-surface diagnostic completeness is tracked below. |
| Backup & Restore | Pass for read path | Backup coverage explanation and existing verified backup downloads resolve. No new backup or restore was executed. |
| Browser runtime | Pass | No captured console warning or error was observed during the checked navigation and detail flows. |

## Findings

### Must fix: Update and Doctor truth disagree

The Update Center reports `Up to date`, but the same result says that the approval manifest returned `404 Not Found`, the bundled fallback manifest is in use, and installed Node `22.14.0` is below the required `22.19.0`. Doctor simultaneously reports overall `OK` with zero warnings and zero failures.

This was a real release-readiness gap rather than cosmetic polish. Update source freshness, runtime compatibility, and Doctor status now come from one diagnostic truth.

### Historical only: Mira Skill evidence after a fresh-runtime probe

A Mira Session from 2026-07-12 reports `0 loaded skills` in Prompt Input while the visible model response names `recruit-employee`. The employee-private `recruit-employee/SKILL.md` file existed before that Session. A controlled 2026-07-13 probe after a full runtime restart created a new Direct Message Session whose Prompt Input recorded `13 tools` and `1 loaded skills`; Mira accurately named `recruit-employee`.

The current Runtime is therefore correct. Do not rewrite the historical count or hard-code the Skill name. The probe also found and closed a preview composition defect where the active PI Runtime Provider was not injected into the admin reload controls.

## Decision

No broad new product feature or visual rewrite was justified by this pass. The bounded preview reload and shared diagnostics fixes were completed before the public baseline.

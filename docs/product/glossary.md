# Product Glossary

This page defines the terms TinyOffice agents should use consistently in product docs, code discussion, and implementation notes.

## Rules

- Use the terms here before inventing new names.
- Keep product terms separate from internal table names, route names, and runtime selectors.
- Do not use retired carrier or old frontend terminology as product language.
- When a term is not implemented yet, say so directly in the relevant product or status page.

## Core Objects

| Term | Meaning |
| --- | --- |
| Company | The tenant and product boundary for TinyOffice data, members, chat, work, runtime sessions, and configuration. |
| Member | A person or runtime-capable actor inside a company. Product UI should bias toward member-facing language. |
| Employee | Current internal/runtime-capable member concept. It may still appear in APIs, tables, selectors, and docs that describe implementation. |
| Workspace | The collaboration surface where company members see channels, direct messages, topics, threads, context, and work signals. |
| Channel | A multi-member collaboration space. A channel contains topics and has members, purpose, and activity state. |
| Direct Message | A one-to-one collaboration space between the current user and another member/runtime-capable employee. |
| Topic | A visible collaboration entry under a channel or direct message. It is the list item users click before entering the message thread. |
| Thread | The message flow for a selected topic. In UI terms, this is where messages are read and sent. |
| Message | A visible chat entry in a thread. Messages may be authored by the current user or another member/runtime-capable employee. |
| Participant | A member involved in a channel, topic, or thread. In direct messages, participant display should stay minimal because the counterpart is already clear. |
| Composer | The input area used to create a new topic or send a message into an existing thread. |
| Context Panel | The right-side supporting panel that shows only relevant current object details, such as topic metadata, channel members, or sessions when real evidence exists. |

## Work And Runtime

| Term | Meaning |
| --- | --- |
| Work | Formal background work that needs execution, recovery, verification, or retry. |
| WorkTask | The durable task object for background work. |
| WorkSchedule | The trigger or recurrence rule for a WorkTask. |
| WorkRun | One execution instance of a WorkTask. |
| Session | A runtime conversation or execution context for a member/employee. |
| Process Trace | Runtime process details, tool calls, reasoning summaries, and execution events. It is observability material, not primary chat content. |
| Access | Policy and approval handling for sensitive resources or high-risk actions. |
| Tool Guard | Internal mechanism that classifies and controls tool calls. User-facing product language should usually say Access. |

## Frontend Terms

| Term | Meaning |
| --- | --- |
| shadcn frontend | The current TinyOffice frontend rebuild target at `apps/tinyoffice-web-shadcn`. |
| shadcn primitive | Official shadcn/ui component source added through the CLI or approved registry. |
| Product composition component | A TinyOffice-specific component that composes shadcn primitives, such as workspace shell, chat sidebar, room view, composer, or context panel. |
| Retired local primitives | Old local UI primitives, old page shells, and old CSS classes. They are not a frontend foundation, reference, fallback, or compatibility target. |

## Boundary Terms

| Term | Meaning |
| --- | --- |
| Product truth | Stable product intent and accepted behavior recorded in `docs/`. |
| Runtime truth | Current data and execution state stored in TinyOffice runtime/database systems. |
| Implementation boundary | The concrete files, APIs, contracts, and services responsible for a capability. |
| Not rebuilt yet | A surface or capability that exists in product direction or backend capability but has not been implemented in the shadcn frontend. |
| Hard cut | Removing or replacing an old path without hidden compatibility aliases, fallback behavior, or parallel product surfaces. |

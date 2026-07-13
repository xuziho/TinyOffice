# Product Feature Map

This page is a reading map for current TinyOffice product features.

TinyOffice is one modular monolith for a personal AI company operating system. It provides persistent member identity, runtime-capable member execution, TinyOffice-owned collaboration memory, background Work, runtime evidence, Access policy, and PostgreSQL-backed company data. It is not a bundle of built-in vertical business apps, and it is not a microservice split.

| Area | Read For | Entry |
| --- | --- | --- |
| Architecture direction | The governing product boundary: one modular monolith, internal layers, and PostgreSQL fact database. | [Modular Monolith Direction](modular-monolith-architecture.md) |
| Collaboration memory | Where members collaborate, how messages enter runtime, and how TinyOffice-owned Conversation / Message truth is exposed. | [Chat](chat.md), [Conversation / Message Contract](../technical/conversation-message-contract.md), [Topic / Handoff](topic-handoff.md), [Access Requests](approval.md), [Process Trace](process-trace.md), [Realtime Intake](realtime-intake.md) |
| Background work | How work becomes WorkTask / WorkSchedule / WorkRun and how it is inspected and operated. | [Work System](work-system.md), [Tasks](tasks.md), [Sessions](sessions.md) |
| Members and runtime | Member identity, runtime-capable employee configuration, lightweight Chat runtime summary, sessions, memory, and capability sources. | [Employee Config](employee-config.md), [Employee Runtime Summary](employee-status.md), [Sessions](sessions.md), [Skills / Runbooks](skills-runbooks.md) |
| Runtime policy and diagnostics | Prompt policy, Access policy, runtime evidence review, and read-only system diagnostics. | [Prompt Policy](prompt-policy.md), [Access](tool-safety.md), [Sessions](sessions.md), [Tasks](tasks.md), [Operations Surface](console.md) |
| Company data | PostgreSQL-backed runtime storage and company data boundary. | [Company Storage Boundary](../company-storage-boundary.md) |

Archive content does not belong in the daily reading path.

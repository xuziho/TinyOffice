# Work Actions Technical Implementation

This page records the technical boundary for model-visible tools and final-result protocols. Product behavior is documented in [Work Actions And Access Boundaries](../product/work-actions-and-approvals.md).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/runtime/registry/register-default-collaboration-actions.ts` | Keeps the empty-registration boundary; state-changing exits moved to scene final-result tools. |
| `src/collaboration/actions/action-specs.ts` | Keeps the empty mounted-action baseline and prevents old state tools from being reintroduced. |
| `src/collaboration/pi/collaboration-actions-extension.ts` | Exposes Chat `handoff_topic_turn`, `finish_intake_turn`, `finish_work_turn`, and read-only `recall_memory`. |
| `src/runtime/pi/persistent-pi-session-transport.ts` | Injects the host-owned collaboration extension through PI `extensionFactories`, so TinyOffice business tools share the Runtime's event and service boundary. It must not be reloaded as an isolated project Package. |
| `src/runtime/realtime/channel-turn-result-protocol.ts` | Channel Topic handoff protocol; Runtime records Handoff and updates Topic owner from `toId`. |
| TinyOffice Chat state-action parser | Parses Channel handoff from tool-call events. Chat visible replies come from assistant messages, not tool arguments. Legacy approval fields must not create broad business approvals. |
| `src/work/finish-work-turn-result.ts` | WorkRun `finish_work_turn` completion policy and result validation. |
| `src/work/work-execution-service.ts` | Applies `finish_work_turn` events to WorkRun state. |

## Current Boundary

| Name | Binding |
| --- | --- |
| `recall_memory` | Read-only runtime memory tool. |
| `handoff_topic_turn` | Channel Topic owner and Handoff state-action tool. |
| `finish_intake_turn` | External intake triage result: create Work, record event, or surface an explicit Access/resource boundary. |
| `finish_work_turn` | WorkRun state final-result tool. |

Access requests are created by the concrete tool/access layer when a sensitive resource or high-risk command is touched. Final-result tools should not be used to ask Runtime to approve broad business actions.

## Verification

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test --test-concurrency=1 tests\collaboration\collaboration-actions-extension.test.ts tests\work\work-execution-service.test.ts
```

# Realtime Intake Technical Implementation

This page records the current TinyOffice-owned realtime intake boundary. Product intent lives in [Realtime Intake](../product/realtime-intake.md).

## Module Boundary

| Module | Responsibility |
| --- | --- |
| `src/runtime/realtime/tinyoffice-chat-turn-dispatch.ts` | Decides whether an owned Chat message should wake a runtime-capable member. |
| `src/collaboration/` | Conversation, message, participant, room, and Chat projection storage/API contracts. |
| `src/collaboration/contracts/tinyoffice-realtime-contract.ts` | WebSocket event envelope for Chat and runtime status updates. |
| `src/runtime/realtime/process-trace-store.ts` | Persists process trace evidence for runtime work. |
| `scripts/runtime/run-tinyoffice.ts` | Starts the local real Chat preview against PostgreSQL-backed runtime data. |

## Data Flow

1. A TinyOffice-owned Chat API stores a message in the Conversation/Message store.
2. Chat dispatch resolves the selected room, participants, mentions, and runtime-capable target.
3. Runtime dispatch starts or continues the target member session when the room and permissions allow it.
4. The runtime provider writes reply/evidence through TinyOffice-owned persistence.
5. Socket.io realtime events notify the 5175 frontend about new messages, read state, projection changes, runtime status, and active reply streaming.

## Verification

```powershell
npm run smoke:no-carrier-chat
npm run smoke:standalone-frontend-browser
npm start
```

# Company-Scoped Smoke Matrix

Use this matrix when validating that runtime behavior stays inside the selected Company.

| Scenario | Expected behavior | Evidence |
| --- | --- | --- |
| TinyOffice Chat DM | The request carries explicit `companyId` and member/runtime identity. Runtime wakes only the allowed peer in that Company. | Chat message, session record, process trace, realtime event. |
| TinyOffice Channel/Topic | Topic and participants resolve inside the selected Company. Runtime wakes only explicitly targeted runtime-capable participants. | Topic room messages, participant list, dispatch decision, session/trace evidence. |
| Missing Company context | Runtime rejects before loading member/config/runtime data. | Error response and absence of session/process trace writes. |
| Cross-company member id collision | The selected Company controls which member/runtime profile is loaded. | Company-scoped repository query and no writes under the other Company. |

Default verification:

```powershell
npm run smoke:no-carrier-chat
npm start
```

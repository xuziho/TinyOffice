# Runtime Memory 技术实现

本页记录 Runtime Memory 的技术边界。产品说明见 [员工与会话](../product/employees-and-sessions.md)。

## 边界

Runtime Memory 保存 session 完成后的摘要记忆，并通过 `recall_memory` 提供只读召回能力。它不改变 Work 状态，也不改变路由。

## 主要数据

| 数据 | 用途 |
| --- | --- |
| memory summaries | 保存可复用的 session 结论。 |
| employee id | 限定员工视角。 |
| WorkRun id / category | 支持按上下文召回。 |

## 验证

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests\runtime\persistent-pi-employee-agent.test.ts
```

# Work 数据模型技术实现

本页记录 WorkTask / WorkSchedule / WorkRun 的目标数据模型和当前实现映射。产品说明见 [Work System](../product/work-system.md)。

PostgreSQL、repository、WorkService、dispatch、execution、intake creation、evidence query 与 Tasks 已经切到 `work_tasks`、`work_schedules`、`work_runs.work_task_id` 和 WorkTask / WorkSchedule / WorkRun 调用语义。Chat 里的员工状态只展示轻量当前工作和需处理状态；Work 的完整处理、历史和证据仍归 Tasks、Sessions 与 Process Trace。

## 核心表

| 表 | 职责 |
| --- | --- |
| `work_tasks` | 后台工作任务定义。 |
| `work_schedules` | 定时或循环触发规则。 |
| `work_runs` | 一次执行实例。 |
| `work_run_events` | WorkRun 状态变化和员工动作。 |
| `work_dispatch_leases` | 分派租约。 |

## 代码入口

| 模块 | 职责 |
| --- | --- |
| `src/work/domain.ts` | Work domain 类型。 |
| `src/work/work-repository.ts` | repository 接口。 |
| `src/work/postgres-work-repository.ts` | PostgreSQL repository。 |
| `src/work/work-service.ts` | 创建 WorkTask / WorkSchedule / WorkRun，推进 WorkRun 状态。 |
| `src/work/company-control-plane.ts` | 公司调度控制层：扫描到期 WorkSchedule，创建 queued WorkRun，恢复过期分派租约，并调用分派执行入口。 |
| `src/work/work-dispatcher.ts` | 选择可分派的 queued WorkRun。 |
| `src/work/work-execution-service.ts` | 启动员工 `work_run_execution` session 并处理 `finish_work_turn`。 |

## 测试

```powershell
node --import tsx --test tests\work\work-service.test.ts tests\work\work-execution-service.test.ts tests\work\company-control-plane.test.ts
```

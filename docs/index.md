# TinyOffice 产品架构手册

<section class="manual-hero">
  <div>
    <p class="manual-eyebrow">Product Architecture Manual / Development Map</p>
    <h1>TinyOffice 产品架构手册</h1>
    <p class="manual-lead">
      这是开发期的产品架构记忆：用来帮助产品负责人和后续 AI 开发会话判断一个功能属于哪个产品对象、跨哪些实现层、要改哪些入口、怎么验证。
    </p>
  </div>
  <div class="manual-status">
    <span>当前用途</span>
    <strong>产品架构 + 开发行动索引</strong>
    <code>docs/ + mkdocs.yml</code>
  </div>
</section>

这份文档不是面向最终用户的功能说明书。它的第一用途是服务开发：当你要新增功能、调整行为、排查差异或交给下一次 AI 开发会话时，可以从这里恢复 TinyOffice 的产品结构、实现归属、数据边界和验证路径。

## 这份文档叫什么

推荐名称：**产品架构手册（Product Architecture Manual）**。

这个名字比“产品文档”更准确，因为它不只描述功能，还记录：

- 产品对象和工作现场如何组织。
- 一个能力应该归到哪个实现层。
- 哪些代码、数据表、配置和验证命令会被牵动。
- 哪些判断已经确认，哪些差异应进入 GitHub Issue。

`docs/` 仍然是长期产品真相来源；聊天记录、临时 PRD、迁移日志和根目录旧规划只能作为线索。

## 开发时先问的五个问题

| 问题 | 用来判断什么 | 先读哪里 |
| --- | --- | --- |
| 这是哪个工作现场的问题？ | Chat、Conversation、Message、Work、Intake 还是 Operations Surface。 | [Chat Entry Contract](technical/chat-entry-contract.md)、[Conversation / Message Contract](technical/conversation-message-contract.md)、[工作模型](product/work-system.md)、[Realtime Intake](product/realtime-intake.md) |
| 它改变了哪个产品对象？ | Employee、Session、ChannelTopic、WorkTask、WorkSchedule、WorkRun、Approval、Memory、PostgreSQL runtime storage。 | [员工与会话](product/employees-and-sessions.md)、[产品模型](product/product-models.md)、[产品术语](product/glossary.md) |
| 它跨哪些实现层？ | Frontend UI、TinyOffice API、Company Runtime、Work Memory / Conversation Message 服务、PostgreSQL 事实库。 | [模块化单体方向](product/modular-monolith-architecture.md)、[系统地图](status/system-map.md)、[功能能力清单](status/feature-inventory.md) |
| 它是否改变稳定产品判断？ | 需要直接改文档、建 Issue，还是只补实现。 | [开发协作流程](developer/development-workflow.md) |
| 它怎么验证？ | 应跑哪些测试、构建或 runtime 检查。 | [运行与验证](developer/runbook.md)、相关功能页 |

## 双坐标结构

TinyOffice 的开发判断需要两个坐标一起看。

第一个坐标是**产品对象 / 工作现场**：它回答“这个能力在产品里属于什么东西”。

| 坐标 | 典型问题 |
| --- | --- |
| Chat / Conversation / Message | TinyOffice-owned Chat 容器、open target、Conversation 和 Message 如何表达协作现场。 |
| Work | 哪些事项应成为独立后台工作，如何形成 WorkTask / WorkSchedule / WorkRun，并支持分派、阻塞、恢复。 |
| Intake | 外部信号如何投递给员工，为什么不自动创建 WorkTask / WorkSchedule / WorkRun。 |
| Operations Surface | 配置、后台工作、员工状态和会话如何被观察和维护。 |

第二个坐标是**实现层级**：它回答“实现这个能力要改哪里”。

| 实现层级 | 职责 |
| --- | --- |
| Frontend UI | TinyOffice-owned shadcn standalone frontend and operations surfaces. |
| TinyOffice API | Company、Employee、Work、Conversation、Message、policy 和 evidence 的产品 API。 |
| Company Runtime | persistent employee agent、session continuity、WorkRun execution、prompt blocks、skills、memory recall。 |
| Work Memory / Conversation and Message 服务 | Conversation、Message、Participant、Attachment、runtime memory、session records 和 realtime event。 |
| PostgreSQL 统一事实库 | Company、Employee、Session、WorkTask、WorkSchedule、WorkRun、Trace、Conversation、Message 和相关运行状态。 |

新增功能时，不要只问“它在哪个代码目录”。先用产品对象定位，再用实现层级拆分改动面。

## 主阅读路径

```text
产品架构入口
  -> 工作现场
  -> 核心对象与协作机制
  -> 实现层级
  -> 数据与运行
  -> 开发行动索引
```

推荐阅读顺序：

1. [模块化单体方向](product/modular-monolith-architecture.md)：先确认 TinyOffice 是一个模块化单体产品，以及 PostgreSQL 边界。
2. [产品模型](product/product-models.md)：恢复当前稳定产品对象和边界。
3. [产品模型与源码核对](status/product-model-and-source-alignment.md)：查看当前实现状态和已知 docs/code 差异。
3. [功能能力清单](status/feature-inventory.md)：查代码里已经存在的能力归属。
4. [系统地图](status/system-map.md)：把产品对象映射到代码模块。
5. 相关功能页：确认当前实现、边界和验证命令。

## 快速入口

<div class="manual-grid cards" markdown>

-   :material-view-dashboard-outline:{ .manual-card-icon } **当前仪表盘**

    当前阶段、可用能力、风险、验证状态和下一批整理重点。

    [打开仪表盘](status/dashboard.md)

-   :material-sitemap-outline:{ .manual-card-icon } **系统地图**

    产品层次、模块地图、数据边界和跨模块主链路。

    [查看系统地图](status/system-map.md)

-   :material-layers-triple-outline:{ .manual-card-icon } **模块化单体方向**

    一个 TinyOffice 产品，清晰内部层次，PostgreSQL 统一事实库。

    [查看架构方向](product/modular-monolith-architecture.md)

-   :material-format-list-bulleted-type:{ .manual-card-icon } **功能能力清单**

    已有能力、产品判断、实现入口和后续跟踪的全量索引。

    [查看能力清单](status/feature-inventory.md)

-   :material-checkbox-marked-circle-auto-outline:{ .manual-card-icon } **工作模型**

    WorkTask / WorkSchedule / WorkRun 的创建、分派、执行、阻塞恢复和控制动作。

    [查看工作模型](product/work-system.md)

-   :material-console:{ .manual-card-icon } **Operations Surface**

    本地运维和配置索引；当前产品配置入口以 standalone React rail 和 company-scoped API 为准。

    [查看 Operations Surface](product/console.md)

</div>

## 常用命令

=== "预览手册"

    ```powershell
    npm run docs:serve
    ```

=== "构建手册"

    ```powershell
    npm run docs:build
    ```

=== "验证项目"

    ```powershell
    npm run check
    npm test
    ```

## 维护规则

!!! note "长期真相"
    `docs/` 只放稳定产品架构、功能边界、代码入口、验证命令和决策。临时调查、一次性迁移材料、草稿和审计过程放在 `.scratch/`。如果代码和文档不一致，先确认当前事实和产品判断；需要追踪的差异建 GitHub Issue，结论稳定后再写回手册。

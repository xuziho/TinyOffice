# 数据迁移与恢复

本页解决一个判断：迁移文档只记录稳定流程和风险，不保存一次性机器路径和临时排查细节。

## 当前产品事实

迁移目标是让 TinyOffice 的协作运行时在新环境中恢复可用，而不是把旧机器状态原样塞进产品仓库。

TinyOffice 仍处于 pre-release 阶段。当前 PostgreSQL 数据被视为可重建的开发/测试数据，不承诺历史 schema 兼容。数据库结构以当前 pre-release baseline 为准；旧测试库如果带有 retired migration history，应使用 reset 流程重建，而不是通过旧列、旧表、双字段兼容脚本继续迁移。

迁移应覆盖：

- TinyOffice PostgreSQL `tinyoffice` runtime database。
- Company records, member directory, Chat, Work, Session, Trace, Access, prompt, and runtime configuration stored in PostgreSQL.
- `companies/<companyId>/employees/<employeeId>/` 员工目录和工作区。
- 必要的 `.scratch/` 迁移审计材料。

## 数据边界

| 数据 | 是否进入 Git | 说明 |
| --- | --- | --- |
| `docs/` 中的稳定迁移流程 | 是 | 记录长期流程、风险和验收方式。 |
| PostgreSQL `tinyoffice` database | 否 | TinyOffice live runtime 数据底座。 |
| `.scratch/` 迁移审计材料 | 否 | 一次性证据和中间文件。 |
| 脱敏后的配置模板 | 可以 | 只保存可复用结构，不保存敏感值。 |

## Company 生命周期边界

恢复和迁移必须保持 Company 是用户可见产品对象。Company 创建、删除、成员、Chat、Work、Session、Trace、Access、Prompt、Runtime 配置都应使用 TinyOffice-owned 数据和 API 边界。

首次部署和后续新增公司使用同一套 Company 创建流程。删除 Company 时，恢复和清理流程必须把公司作用域 runtime 数据、员工工作区资产、Chat/Work/Session/Trace evidence 和配置数据一起纳入清理边界。

Company 创建流程允许单独选择 System AI model。该模型用于公司级后台能力，例如 Chat 标题生成和 Topic 摘要刷新；它不默认复用首个 HR runtime member 的模型，因为员工对话和系统级摘要/标题生成的性能需求可能不同。创建时可以先跳过 System AI model，后续在 Company 页面里的 System AI Settings 面板分别配置 Chat title generation 和 Topic summaries。

Company Blueprint 只用于 seed 新 Company。它不是隐藏 Company，不进入 `companies` 表，不代表 runtime/business history；迁移时不应把 Blueprint 当成可恢复的租户数据。

## 本地覆盖恢复

当新环境刚迁移、没有有效本地数据时，可以直接覆盖本地 runtime。覆盖前仍应保留一份备份，避免误删唯一数据源。

开发期 PostgreSQL 结构不匹配时，优先使用 `npm run runtime:postgres:reset`。该命令会删除本地 TinyOffice PostgreSQL container 和 volume，再用当前 baseline 初始化 schema。不要为了保留测试数据新增历史兼容 migration。

覆盖恢复后必须验证：

- TinyOffice API 可启动。
- TinyOffice realtime WebSocket 可连接。
- Standalone frontend 可打开当前 Company。
- Company / Members / Chat / Tasks / Sessions / Runtime / Prompt / Access 关键页面能读取恢复后的数据。
- TinyOffice 测试和类型检查通过。

## 已知迁移风险

| 风险 | 说明 | 处理方式 |
| --- | --- | --- |
| 数据库密码不一致 | 恢复 `.env` 与 PostgreSQL 用户密码可能不一致。 | 以恢复后的 `.env` 为准，必要时 `ALTER USER`。 |
| 绝对路径残留 | 旧主机路径不能写入长期产品架构文档或配置。 | 产品架构手册使用相对路径，部署脚本按主机生成实际路径。 |
| 本地状态污染 | 新旧 `.data/`、PostgreSQL volume、`.scratch/` 审计材料混在一起。 | 覆盖前备份，恢复后按验收清单验证。 |

## 验证方式

- TinyOffice API health check 正常。
- Standalone frontend 能打开当前 Company。
- Realtime WebSocket 能连接并接收 Chat/Runtime event。
- `npm run check` 通过。
- `npm test` 通过。
- `npm run docs:build` 通过。

## 不做什么

- 不把临时备份路径写进长期正文。
- 不把私有数据库或上传文件提交到 Git。
- 不把一次性排错过程当成长期迁移流程。

## 下一步整理重点

- 把恢复验收清单拆成 PostgreSQL、TinyOffice API/realtime、standalone frontend、employee runtime workspace 四组。
- 将可复用脚本和不可复用手工步骤分开记录。

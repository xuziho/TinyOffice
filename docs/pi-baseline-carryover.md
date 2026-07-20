# PI 基座与扩展边界

TinyOffice 使用 PI Coding Agent 作为当前 Runtime provider，但 TinyOffice 的产品运行边界不等于一套可以任意安装 PI Marketplace Extension 的 PI CLI。

## 当前结论

TinyOffice 员工 Runtime 只加载代码中明确批准的内部扩展：

| 内部扩展 | 作用 |
| --- | --- |
| `pi-tool-guard` | 低层文件与命令工具的 Access 边界。 |
| `pi-web-tools` | `webfetch` 与 `websearch`。 |
| `tinyoffice-collaboration-actions` | Handoff、Work/Intake 完成动作、Capability 与 Runtime Memory 工具。 |
| `pi-context-harness` | 上下文压缩、continuation 与工具结果收敛。 |

这些扩展由 TinyOffice Runtime 源码直接注册。宿主机的 `~/.pi/agent/settings.json`、员工工作区的 `.pi/settings.json`、全局 extensions 目录和项目 extensions 目录都不是 TinyOffice Runtime 的加载权威。

员工自有 Skills 仍通过 TinyOffice 的 Company / Employee Skill 边界显式加载；它们不依赖 PI 全局配置。

System AI 的标题与 Topic Summary 调用是独立、无历史调用，并且不加载 Extension、Skill、Prompt Template、Theme、Context File 或 Tool。

## 为什么不直接开放 PI Marketplace

PI Extension 可以注册工具，也可以拦截上下文、模型请求、工具调用、压缩和 session 生命周期。有些扩展依赖 PI 的终端 UI、模型切换或自身权限模型。这些行为可能绕过 TinyOffice 的公司隔离、固定员工模型、Access、Handoff、Work 和 Evidence 规则。

因此当前产品承诺是：

- 正式支持 TinyOffice Skills；
- 后续正式支持 TinyOffice-managed MCP；
- 不承诺任意 PI Marketplace Extension 可以直接安装到 TinyOffice；
- 若某个 PI Extension 有明确价值，先由 TinyOffice 评估并适配，再加入内部批准清单。

## 本地 PI CLI 与 TinyOffice Runtime

开发者仍然可以在独立的 PI CLI 环境里试验本地 packages，但 `pi install -l ...` 只影响那套 PI CLI 环境，不会改变 TinyOffice 产品 Runtime 的批准清单。

不要通过修改员工工作区 `.pi/settings.json` 给 TinyOffice 员工增加 Extension。需要增加产品能力时，应选择以下边界之一：

1. 可复用工作方法：创建 Company 或 Employee Skill；
2. 外部系统工具：接入 TinyOffice-managed MCP；
3. Runtime 基础能力：经过代码审查后加入内部批准扩展清单。

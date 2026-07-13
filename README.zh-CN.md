<p align="center">
  <img src="docs/assets/brand/tinyoffice-lockup-on-paper.svg" width="220" alt="TinyOffice——戴着墨镜、露出歪嘴笑容的青色 TO Boss 标志" />
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# TinyOffice

TinyOffice 是一个处于早期阶段、支持自托管的公司运营基础系统，面向长期存在的 AI 员工以及与它们共同工作的人。它把类似 Slack / Discord 的协作工作区，与运行时会话、后台任务、执行证据和轻量治理能力组合在一起。

<!-- 为项目作者保留的创作者说明；在正式公开发布说明前由作者本人填写。 -->

> TinyOffice 目前以早期公开 Alpha 版本提供，尚不适合生产环境。身份认证与部署加固仍未完成。

## 仓库内容

- `apps/tinyoffice-web-shadcn/`：基于 shadcn/ui 的独立前端。
- `src/`：运行时、协作、治理、API 与存储代码。
- `packages/`：可复用的运行时包。
- `scripts/`：本地运行、验证、备份与文档工具。
- `tests/`：运行时与契约测试。
- `docs/`：产品手册，也是预期产品行为的事实来源。

本地公司记录、员工工作区、上传资产、密钥、运行时数据库、截图和 QA 验收文件不会进入公开源码边界。

## 环境要求

- Node.js 22.19 或更高版本。
- npm。
- Docker，用于运行基于 PostgreSQL 的本地运行时。
- Windows 环境推荐使用 PowerShell 7 执行仓库提供的运行脚本。

## 本地开发

```powershell
npm run setup
npm run runtime:postgres:ensure
npm run runtime:postgres:init-schema
$env:TINYOFFICE_PREVIEW_USER_ID = "local-owner"
$env:TINYOFFICE_PREVIEW_USER_DISPLAY_NAME = "Local Owner"
node --import tsx scripts/runtime/run-real-chat-preview.ts
```

`setup` 命令会同时安装根目录运行时依赖和独立 shadcn 前端依赖。执行前请确认 `node --version` 为 Node.js 22.19 或更高版本；不受支持的 Node 版本即使只显示警告并完成安装，也不属于有效的 TinyOffice 运行环境。

预览启动后，Web 应用位于 `http://127.0.0.1:5175`，运行时 API 位于 `http://127.0.0.1:8095`。`TINYOFFICE_PREVIEW_USER_ID` 是稳定的本地开发身份，显示名称可以省略。执行全新首次用户流程时，不要设置 `TINYOFFICE_PREVIEW_COMPANY_ID`。Company 和成员记录应通过产品生命周期创建；仓库不会附带隐藏的默认 Company。隔离运行且不会影响现有本地 Company 的验收方式，请参阅[首次用户引导验收手册](docs/developer/runbooks/first-user-onboarding.md)。

常用检查：

```powershell
npm run check
npm test
npm run docs:build
npm run check:open-source
```

完整的本地验证路径请参阅[开发运行手册](docs/developer/runbook.md)。

## 配置与数据边界

`.env.example` 仅用于参考可选环境变量。不要提交真实的供应商密钥或公司数据。TinyOffice 运行时数据应存放在 PostgreSQL 和已被忽略的本地运行目录中，而不是源码仓库中。

## 项目状态与文档

`docs/` 中的 Markdown 产品手册记录了产品意图、当前范围、架构决策、实现映射和验证方式。建议从[产品手册](docs/index.md)和[功能地图](docs/product/feature-map.md)开始阅读。

本仓库是 TinyOffice 的正式公开仓库。从私有孵化阶段迁移到公开仓库的过程记录在[开源分发说明](docs/product/open-source-distribution.md)中。

## 贡献与安全

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。如果发现疑似安全问题，请按照 [SECURITY.md](SECURITY.md) 中的私密流程报告，不要创建公开 Issue。

## 许可证

TinyOffice 使用 [Apache License 2.0](LICENSE) 许可证。第三方归属信息记录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中。

# PI 基座能力承接

这份文档只回答一个问题：

`新项目现在如何直接复用已经完成的 PI 基座能力。`

## 结论

PI 基座现在已经足够当作新项目起点使用。

你需要的资产分成三类：

1. 本地 `pi-web-tools` package
2. 本地 `pi-tool-guard` package
3. 本地 `pi-context-harness` package

## 本地 PI 能力包

这些 package 都是 PI 自身能力增强，原则上可以离开本系统单独安装使用：

- `packages/pi-web-tools`
- `packages/pi-tool-guard`
- `packages/pi-context-harness`

`pi-web-tools` 提供：

- `webfetch`
- `websearch`

`pi-tool-guard` 提供本地工具调用安全边界。

`pi-context-harness` 提供当前 session 内的上下文压缩与 continuation 辅助。

## 建议安装方式

在新项目目录里，把这个 package 装进 PI：

```bash
pi install -l ./packages/pi-web-tools
pi install -l ./packages/pi-tool-guard
pi install -l ./packages/pi-context-harness
```

## 运行时说明

### `webfetch`

- 不需要外部 API key

### `websearch`

支持：

- `TAVILY_API_KEYS`
- `TAVILY_API_KEY`
- `BRAVE_API_KEY`

可选 provider override：

```bash
export PI_WEBSEARCH_PROVIDER="tavily"
```

## 现在不做的事

这一步先不要求：

- 发布 npm 公共包
- 重写 PI web tools package
- 把本地 `pi-tool-guard` 或 `pi-context-harness` 合并进 `pi-web-tools`

这几件事都不该阻塞新项目启动。

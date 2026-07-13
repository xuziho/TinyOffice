# pi-web-tools

Standalone local-path PI package for web access tools.

## Included Extensions

- `webfetch`
- `websearch`

## Intended Companion Package

This package is designed to coexist with:

- the local `packages/pi-tool-guard` package

## Install From Local Path

```bash
pi install -l /absolute/path/to/packages/pi-web-tools
```

Recommended companion install:

```bash
pi install -l /absolute/path/to/packages/pi-tool-guard
```

## Environment

`webfetch` requires no external API key.

`websearch` currently supports:

- `TAVILY_API_KEYS`
- `TAVILY_API_KEY`
- `BRAVE_API_KEY`

Optional provider override:

```bash
export PI_WEBSEARCH_PROVIDER="tavily"
```

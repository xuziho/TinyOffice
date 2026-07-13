# 2026-06-11 Product Manual Home Decision

## Decision

The TinyOffice product manual lives in the TinyOffice repository:

```text
docs/
```

The source files live in `docs/`, and navigation lives in `mkdocs.yml`.

## Reason

The manual must stay with the product code, product APIs, verification scripts, and current implementation boundaries. Keeping it in the product repository reduces workspace confusion and makes future documentation changes reviewable with the code they describe.

## Current Rule

`docs/` is the current product manual. Other repositories, deleted paths, archived pages, and chat history are not product truth.

If repository boundaries change again, update these current pages:

- `docs/status/system-map.md`
- `docs/status/repository-boundaries.md`
- `docs/developer/runbook.md`
- `mkdocs.yml`

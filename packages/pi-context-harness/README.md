# pi-context-harness

PI extension for single-session context continuity.

Context harness capabilities:

- keep small tool results inline
- store large raw tool results under `.pi/pi-context-harness/tool-results/`
- replace large model-facing tool results with compact digests
- write Claude Code-style compact summaries through PI's `session_before_compact`
- optionally dispatch a compact-after continuation prompt
- optionally request auto-compaction when explicitly enabled and estimated model-facing context crosses configured token thresholds
- retry LLM summary generation with older transcript chunks omitted before falling back to the basic summary
- downgrade media/attachment blocks to compact markers during summary generation
- inspect provider payloads and provider cache headers in diagnostic mode without rewriting them
- record local telemetry under `.pi/pi-context-harness/telemetry.jsonl`

This package is intentionally PI-layer only. It does not implement long-term
memory, cross-session recall, company facts, approvals, channel topics, or
frontend state.

Install locally with PI:

```bash
pi install -l /home/xu/CodeXProject/TinyOffice/packages/pi-context-harness
```

Configuration:

- `PI_CONTEXT_HARNESS_RAW_BYTES_THRESHOLD`: raw text threshold for tool-result slimming. Defaults to `30000`, matching Claude Code's documented default Bash output length before saving full output to a file.
- `PI_CONTEXT_HARNESS_TOKEN_THRESHOLD`: estimated token threshold for tool-result slimming. Defaults to `25000`, matching public Claude Code issue evidence for the Read tool's hard-refusal tier; Anthropic's public docs do not currently document this Read-token number as an official setting.
- `PI_CONTEXT_HARNESS_SUMMARY_MODE`: `basic` or `llm`. Defaults to `basic`.
- `PI_CONTEXT_HARNESS_SUMMARY_MAX_CHARS`: max generated summary size. Defaults to `24000`.
- `PI_CONTEXT_HARNESS_CONTINUATION`: set to `0` to disable compact-after continuation. Defaults to on.
- `PI_CONTEXT_HARNESS_AUTO_COMPACT`: set to `1` to enable harness auto-compact requests. Defaults to off so PI's native auto-compaction trigger remains authoritative.
- `PI_CONTEXT_HARNESS_AUTO_COMPACT_WINDOW`: token window used for auto-compact calculations. Defaults to `0`, meaning use the active model's `contextWindow`, falling back to `200000` when unavailable. If set, it is capped to the model context window.
- `PI_CONTEXT_HARNESS_WARNING_PERCENT`: estimated context-window warning percentage. Defaults to `80`.
- `PI_CONTEXT_HARNESS_AUTO_COMPACT_PERCENT`: auto-compact trigger percentage. Defaults to `95`, matching Claude Code's documented default auto-compaction trigger percentage.
- `PI_CONTEXT_HARNESS_EMERGENCY_PERCENT`: emergency percentage. Defaults to `98`.
- `PI_CONTEXT_HARNESS_AUTO_COMPACT_COOLDOWN_MS`: minimum interval between auto-compact requests. Defaults to `60000`.
- `PI_CONTEXT_HARNESS_MAX_COMPACTION_FAILURES`: consecutive auto-compact failures before the breaker opens. Defaults to `2`.
- `PI_CONTEXT_HARNESS_SUMMARY_RETRY_ATTEMPTS`: LLM summary retry attempts with older chunks omitted. Defaults to `2`.
- `PI_CONTEXT_HARNESS_MEDIA_DOWNGRADE`: set to `0` to disable media/attachment downgrade for summaries. Defaults to enabled.
- `PI_CONTEXT_HARNESS_PROVIDER_GUARD`: `diagnostic` or `off`. Defaults to `diagnostic`.

Continuation behavior:

- when PI accepts immediate follow-up dispatch, the harness sends one `deliverAs: "followUp"` continuation prompt
- when PI has already invalidated the extension runtime after compaction, the harness stores a pending continuation under `.pi/pi-context-harness/pending-continuations.json`
- on the next agent start in the same project cwd, the harness injects one hidden `pi-context-harness.continuation` custom message and removes the pending item

Parity boundary:

- this package aims for extension-level Claude Code-style context continuity
- it does not replace PI's native compaction core
- provider payload/cache handling is diagnostic-only by default
- provider prompt-cache editing and deep provider-specific rewrites remain out of scope until PI exposes a safe need and surface

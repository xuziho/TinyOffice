# pi-tool-guard

PI extension for tool-level policy.

V1 is deliberately small:

- blocks reads of sensitive paths such as `.env`, key files, and credentials directories
- blocks writes to sensitive or generated paths
- requires manual approval for runtime configuration writes such as deployment config, environment config, and config-like files containing API keys or tokens
- can require approval or block reads and writes outside cwd when `cwdBoundaryReadMode` or `cwdBoundaryWriteMode` is set to `ask` or `deny`
- blocks dangerous bash command patterns
- does not inject prompt text
- delegates `ask` decisions to the TinyOffice Access runtime bridge when runtime context is configured

The company policy and bridge context are injected by the TinyOffice runtime through:

```text
PI_TOOL_GUARD_POLICY_JSON
TINYOFFICE_API_BASE_URL
TINYOFFICE_COMPANY_ID
PI_EMPLOYEE_ID
PI_CONVERSATION_CONTEXT_JSON
```

The source of truth for that injected value is PostgreSQL
`tool_safety_policies/default`. The guard plugin intentionally does not read a
local policy file.

Default cwd-boundary behavior is intentionally loose:

```json
{
  "cwdBoundaryReadMode": "allow",
  "cwdBoundaryWriteMode": "allow"
}
```

Use `ask` for Access request creation or grant consumption. Use `deny` for hard
blocking without creating an Access request. The `externalWriteAllowPaths` list
remains a write allow-list when `cwdBoundaryWriteMode` is `ask` or `deny`.

This is not an operating-system sandbox. Bash policy is deterministic command
pattern matching before the command runs. Strong isolation still requires a real
sandbox such as a container or VM layer.

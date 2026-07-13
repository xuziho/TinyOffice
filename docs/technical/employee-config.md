# Employee Runtime Technical Implementation

This page records the implementation boundary for runtime-capable member configuration. Product behavior is documented in [Employee Config](../product/employee-config.md) and the identity boundary is documented in [Member Identity Model](../product/member-identity-model.md).

## Current Code Modules

| Module | Responsibility |
| --- | --- |
| `src/runtime/company-config/employees-admin.ts` | Employee Runtime view model and save logic. |
| `src/runtime/company-config/company-directory-repository.ts` | PostgreSQL-backed runtime-capable member directory repository. |
| `src/runtime/registry/employee-home.ts` | Company-scoped EmployeeHome and workspace path resolution. |

## Storage Target

Runtime truth lives in PostgreSQL.

| Data | Target table |
| --- | --- |
| Employee identity, role, presence, enabled state | `employees` |
| Runtime model and thinking level | `member_runtime_profiles` |
| Resource policy | `member_runtime_profiles.resource_policy_json` |

Company is the tenant boundary. Repository and route callers must pass an explicit `companyId`; missing company context is an error.

## File Assets

Employee-local file assets are resolved below the Company-scoped employee home:

```text
companies/<companyId>/employees/<employeeId>/
```

The fixed TinyOffice-owned employee guidance file is:

```text
companies/<companyId>/employees/<employeeId>/AGENTS.md
```

These file assets remain file assets. They are not structured employee configuration rows.

## Routes

| Route | Purpose |
| --- | --- |
| `/api/companies/:companyId/member-runtime` | Current product API for loading runtime-capable member configuration. |
| `/api/companies/:companyId/member-runtime/members/:memberId` | Current product API for saving one runtime-capable member. |
| `/api/agent-controls/reload-employee` | Reload one employee runtime. |
| `/api/agent-controls/reload-employees` | Reload all employee runtimes. |

## Verification

```powershell
node --import tsx --import ./tests/setup-runtime-test-env.ts --test tests/runtime/company-config-employees.test.ts
```

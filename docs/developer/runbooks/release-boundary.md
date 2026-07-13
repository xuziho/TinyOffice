# Release Boundary

Local verification is not deployment authorization.

## Mini-Host And Dogfood

Mini-host or dogfood actions require an explicit user request such as release, update, publish, or check mini-host.

Use the dogfood runbook for details:

- [Dogfood 运行手册](../dogfood-runbook.md)

## Default Order

1. Finish branch/worktree validation.
2. Merge through PR when allowed.
3. Run local `main` smoke when required.
4. Only then perform mini-host release/check if the user explicitly requested it.

Mini-host health checks do not replace local `main` smoke.

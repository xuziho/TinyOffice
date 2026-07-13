# Cleanup

Cleanup is part of acceptance. It should be done from a checkout that is not currently inside the worktree or directory being removed.

## Sequence

1. Confirm PR is merged, closed, or explicitly retained.
2. Check whether services still run from the worktree, including `8095`, plugin server, docs preview, watchers, MCP, connector, or bridge processes.
3. Move or restart services from `main` if they need to keep running.
4. Confirm PR evidence, session ids, logs, and docs sync/build results are recorded.
5. Run pre-archive dependency unlink if the removed worktree still exists.
6. Remove/prune Git worktree metadata and delete unused local/remote branches when this is available without fighting a Windows cwd handle.
7. If only a physical residual directory remains and cleanup reports `cleanup_status=residual_dir_locked`, record it as post-restart cleanup and stop retrying in this task closeout.
8. Confirm no active local session still points at the deleted or residual cwd.

Physical residual worktree directories under the local Codex worktree root are a maintenance concern, not a per-task acceptance blocker, once all of the following are true:

- PR evidence and main acceptance are complete.
- No active PR or task branch still depends on it.
- The child dependency junctions have been unlinked.
- `git worktree list --porcelain` no longer lists the child worktree.
- No active local session points at that cwd.

Do not spend task-closeout time repeatedly deleting a residual physical directory that Windows still reports as in use. App or terminal cwd handles may survive until the app releases the session or restarts. Leave the residual path in the final report and clean it during a user-triggered post-restart cleanup sweep.

## Final Report

The acceptance closeout report is user-facing product memory for the just-finished task. It must be understandable without remembering what an issue number meant.

Do not finish with only "Issue #N passed" or "PR #N merged". Include:

- Issue number and exact title.
- The original goal in plain language.
- What changed, grouped by product behavior, code/docs, workflow, or runtime impact.
- Verification that passed, plus any verification intentionally skipped and why.
- Cleanup result, including deleted branches, worktrees, or residual locked physical directories.
- Remaining risks, non-goals, and the recommended next step.

## Commands

Pre-archive unlink:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/developer/cleanup-codex-worktree.ps1 -WorktreePath "<codex-worktree-root>\<id>\Tiny Office" -PreArchiveUnlinkOnly
```

Full cleanup:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/developer/cleanup-codex-worktree.ps1 -WorktreePath "<codex-worktree-root>\<id>\Tiny Office"
```

Run full cleanup when you are intentionally doing a cleanup sweep or when the target is still a real Git worktree. If Git no longer lists the target as a worktree but the physical directory remains, the cleanup script prunes Git metadata and treats the path as a residual physical directory. Empty or ordinary residual directories are removed after dependency junction checks. If Windows still holds a cwd/file handle, the script reports `cleanup_status=residual_dir_locked`; do not retry in a loop. Treat the path as post-restart cleanup unless the user explicitly asks to investigate the handle.

Do not recursively delete worktree directories before checking dependency junctions and process cwd locks.

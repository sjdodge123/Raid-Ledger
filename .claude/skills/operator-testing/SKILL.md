---
name: operator-testing
description: Deploy the current branch to the local dev environment for hands-on testing. Operator-invoked — overrides whatever is currently deployed.
disable-model-invocation: true
allowed-tools: "Bash(./scripts/deploy_dev.sh*), Bash(git*)"
---

# Operator Testing

Deploy the current branch via `./scripts/deploy_dev.sh` so the operator can test the work in a browser / Discord / API surface.

Aliases: `/opt` (same skill).

## Authority

This skill is **operator-invoked and always overrides** whatever branch is currently deployed. The operator knows what they want to test — when they type `/opt`, take the env. The "don't steal a deployed branch" rule applies to *autonomous agent deploys*, not to this skill.

## Steps

1. Confirm current branch: `git branch --show-current`.
2. (Optional, informational) Run `./scripts/deploy_dev.sh --status` so the report tells the operator what's being replaced. Don't gate on it — just inform.
3. Deploy:
   - With contract/schema changes since the last deploy: `./scripts/deploy_dev.sh --ci --rebuild`
   - Otherwise: `./scripts/deploy_dev.sh --ci`
4. Report the API and Web URLs from the script output (default `:3000` and `:5173`/`:5174`) plus the branch now deployed.
5. If the operator wants a fresh DB: pass `--fresh` (warn that it wipes data).
6. If the operator wants a different branch: switch with `--branch <name>` first.

## Notes

- Worktree-safe — the deploy script auto-detects worktrees and copies `.env` from the main repo.
- For a hard reset with new admin creds, point the operator at `/deploy-fresh` instead.
- This skill does NOT run as part of `/build`, `/dispatch`, or `/bulk` pipelines — those are local-only until Step 5 / Push, per memory rules.

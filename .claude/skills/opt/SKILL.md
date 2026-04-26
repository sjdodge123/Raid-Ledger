---
name: opt
description: Alias for /operator-testing — deploy the current branch to local dev for hands-on testing. Operator-invoked, always overrides whatever is currently deployed.
disable-model-invocation: true
allowed-tools: "Bash(./scripts/deploy_dev.sh*), Bash(git*)"
---

# /opt — alias for /operator-testing

This is an alias for the `/operator-testing` skill. Read and follow the instructions at `.claude/skills/operator-testing/SKILL.md`.

Key point: `/opt` is **operator-invoked and always overrides** the current deploy. The "don't steal a deployed branch" rule applies to *autonomous agent deploys*, not to this skill.

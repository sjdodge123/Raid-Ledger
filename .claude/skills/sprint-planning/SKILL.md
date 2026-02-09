---
name: sprint-planning
description: Plan the next sprint by reviewing open issues, WIP, and recent progress
disable-model-invocation: true
argument-hint: "[milestone or focus area]"
allowed-tools: "Bash(gh *), Bash(git *), Read, Grep, Glob"
---

# Sprint Planning

Help plan the next sprint for the Raid-Ledger project.

## Steps

1. **Check current work in progress:**
   - Run `git status` to see uncommitted changes
   - Run `git log --oneline -20` for recent commit history
   - Run `git branch -a` to see active branches

2. **Review open GitHub issues:**
   - Run `gh issue list --limit 30` to see open issues
   - Run `gh issue list --label "bug" --limit 10` for open bugs
   - Run `gh pr list` for open pull requests

3. **Assess current state:**
   - Identify partially completed work from branches and WIP
   - Note any blocking issues or dependencies
   - Review recent velocity from commit history

4. **Propose sprint plan:**
   - Prioritize bugs and blockers first
   - Group related features together
   - Suggest a realistic scope based on recent velocity
   - If `$ARGUMENTS` was provided, focus the sprint around that milestone or area

5. **Present the plan** as a clear, prioritized task list with:
   - Priority level (P0/P1/P2)
   - Estimated complexity (S/M/L)
   - Dependencies between tasks
   - Suggested order of execution

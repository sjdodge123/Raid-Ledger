# Step 8: Handle Code Review Outcomes

## If reviewer approves (APPROVED or APPROVED WITH FIXES):

**⛔ BEFORE creating a PR, verify ALL commits are pushed to remote. The reviewer may have committed auto-fixes locally that haven't been pushed yet.**

1. **Check for unpushed commits in the worktree:**
   ```bash
   cd ../Raid-Ledger--rok-<num>
   git log origin/rok-<num>-<short-name>..HEAD --oneline
   ```

2. **Run full CI (PR-prep) and push — this is the only time full lint + all tests run:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "PR-prep ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "PR-prep ROK-<num>")
   ```
   **WAIT for the build agent to confirm everything passes before proceeding.**
   The build agent will: sync with origin/main (rebase) -> full CI (build all + lint all + test all) -> push.
   If anything fails, re-spawn the reviewer or dev to fix.

   **DO NOT create the PR until the build agent confirms PR-prep succeeded.**

3. **Create PR and enable auto-merge** (only AFTER PR-prep passes and all commits are on remote):
   ```bash
   gh pr create --base main --head rok-<num>-<short-name> \
     --title "feat(ROK-<num>): <short description>" \
     --body "<summary of changes>"
   gh pr merge <number> --auto --squash
   ```
4. **Once CI passes and PR auto-merges — update Linear → "Done" (MANDATORY):**
   ```
   mcp__linear__update_issue(id: <issue_id>, state: "Done")
   mcp__linear__create_comment(issueId: <issue_id>, body: "Code review passed. PR #<num> merged to main.\nKey files changed: <list>\nCommit SHA(s): <sha>")
   ```
5. Lead removes worktree:
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   ```
6. Report progress:
   ```
   ## [N/total] ROK-XXX — <title>
   PR: #<num> merged to main | Commits: SHA1, SHA2
   ```

## If reviewer requests changes (BLOCKED):

1. Lead updates Linear -> "Changes Requested"
2. **Re-block the review task** in the shared task list (add blocker back)
   - The story must pass operator re-testing before code review can resume
3. **Re-spawn the dev teammate** (it was shut down after CI passed in Step 6c):
   ```
   Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
        name: "dev-rok-<num>", mode: "bypassPermissions",
        prompt: <rework prompt with reviewer feedback>)
   ```
4. Dev teammate fixes in its worktree, **including updating any unit tests affected by the code changes**, commits
5. Dev teammate runs all tests to verify they pass, messages lead when done
6. **Shut down dev teammate** after fixes are committed
7. **Delegate CI validation, push, and deploy to the build agent:**
   ```
   SendMessage(type: "message", recipient: "build-agent",
     content: "Full pipeline: validate, push, deploy ROK-<num>. Worktree: ../Raid-Ledger--rok-<num>, branch: rok-<num>-<short-name>",
     summary: "Full pipeline ROK-<num> reviewer fixes")
   ```
   The build agent will: sync with origin/main (rebase) -> run CI -> push -> deploy feature branch -> verify health -> message lead with results.
   If rebase conflicts or CI fails, the build agent messages back — re-spawn the dev teammate to fix.
8. Lead moves Linear -> "In Review"
9. Notify operator: "ROK-XXX has reviewer fixes re-deployed at localhost:5173 for re-test."
10. **Review task stays BLOCKED** — cycle repeats from Step 7a (operator re-tests)

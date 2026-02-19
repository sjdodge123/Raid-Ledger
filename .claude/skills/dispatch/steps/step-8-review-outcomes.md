# Step 8: Handle Code Review Outcomes

## If reviewer approves:

1. PR auto-merges to main once CI passes (auto-merge was enabled at PR creation).
   If auto-merge is not yet enabled: `gh pr merge <number> --auto --squash`
2. Lead updates Linear -> "Done", posts summary comment:
   - Key files changed, commit SHA(s), PR number
   - Notable decisions or deviations
3. Lead removes worktree:
   ```bash
   git worktree remove ../Raid-Ledger--rok-<num>
   ```
4. Report progress:
   ```
   ## [N/total] ROK-XXX — <title>
   PR: #<num> merged to main | Commits: SHA1, SHA2
   ```

## If reviewer requests changes:

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

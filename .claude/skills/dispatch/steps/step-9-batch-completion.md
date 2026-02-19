# Step 9: Batch Completion + Next Batch

After all stories in a batch are merged (or deferred):

1. **Shut down remaining teammates** (dev + test agents were already shut down in Step 6c):
   ```
   SendMessage(type: "shutdown_request", recipient: "build-agent")
   SendMessage(type: "shutdown_request", recipient: "reviewer")
   SendMessage(type: "shutdown_request", recipient: "playwright-tester")
   ```

2. **Clean up team:**
   ```
   TeamDelete()
   ```

3. **If more batches remain:**
   - **Auto-deploy main** (merged PRs are now on main):
     ```bash
     ./scripts/deploy_dev.sh --rebuild
     ```
   - **Pause and present next batch:**
     ```
     ## Batch N complete — N stories merged to main
     Deployed to localhost:5173 for verification.

     Next batch (N stories):
     - ROK-XXX: <title> — [domains]
     - ROK-YYY: <title> — [domains]

     Say "next" to dispatch the next batch, or "stop" to end dispatch.
     ```
   - **WAIT for operator response** before starting the next batch
   - On "next" -> Go back to Step 5a for the next batch
   - On "stop" -> Proceed to Step 10

4. **If all batches done:** Proceed to Step 10

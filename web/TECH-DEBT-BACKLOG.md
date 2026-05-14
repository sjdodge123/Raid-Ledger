
### 2026-05-14 — fix/batch-2026-05-14 (surfaced during ROK-1282 + ROK-1283 push validation)

- **[med]** `web/src/components/admin/onboarding/secure-account-step.test.tsx` — 6/20 specs in this file flake with `Test timed out in 5000ms` when run as part of the full vitest suite (`npm run test:cov -w web`). All 20 PASS in 773ms when the file is run in isolation (`npx vitest run src/components/admin/onboarding/secure-account-step.test.tsx`). The failing assertions are synchronous DOM class lookups (`toHaveClass('min-h-[44px]')`), so the 5000ms timeout is concurrency starvation, not test logic. Last touched in #379 (months ago); independent of fix/batch-2026-05-14 (zero web/ changes in the batch).
  Suggested: bump this file's `testTimeout` to 15000ms in vitest.config.ts (the FTE wizard tests do heavier jsdom setup than typical) OR move it to its own project shard. The cheap-experiment plan: run `npx vitest run secure-account-step` 50× to characterise the flake rate, then either bump the timeout or shard the file.


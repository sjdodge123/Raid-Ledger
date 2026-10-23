/**
 * ROK-1933 — remove what `POST /admin/test/valheim/claim-drive-fixture` made
 * for a worker (users A/B, characters, sighting). `reset-to-seed` keeps users,
 * so without this the fixture's synthetic-Discord-id users leak into the next
 * smoke group's demo users. Called from `finally`: a cleanup failure is
 * logged, never thrown, so it cannot mask the test's own failure.
 */
import type { TestContext } from "./types.js";

/** Delete the claim-drive fixture's leftovers for `worker`; never throws. */
export async function cleanupClaimDrive(
  ctx: TestContext,
  worker: number,
): Promise<void> {
  await ctx.api
    .post("/admin/test/valheim/claim-drive-cleanup", { worker })
    .catch((err: unknown) => {
      console.warn(`  claim-drive cleanup (worker ${String(worker)}) failed: ${String(err)}`);
    });
}

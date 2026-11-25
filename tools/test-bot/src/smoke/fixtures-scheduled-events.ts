/**
 * Discord scheduled-event fixtures (ROK-969 / ROK-1347 / ROK-1623). Split out
 * of `fixtures.ts`, which re-exports everything here.
 */
import type { ApiClient } from "./api.js";

/**
 * Delete the scheduled events THIS env's bot created — prevents the 100-event
 * limit (ROK-969) without touching a sibling env's events (ROK-1623: CI and the
 * fleet share one guild). Skips are printed, never silent.
 */
export async function cleanupScheduledEvents(api: ApiClient): Promise<void> {
  // Bulk-deleting many events can exceed the default HTTP timeout, so use a generous limit
  const res = await api
    .post<{
      success: boolean;
      deleted: number;
      failed: number;
      skipped?: number;
      total: number;
      reason?: string;
    }>("/admin/test/cleanup-scheduled-events", {})
    .catch(() => null);
  if (!res) return;
  if (res.total > 0) {
    console.log(
      `  Cleaned up ${res.deleted}/${res.total} scheduled events ` +
        `(${res.failed} failed, ${res.skipped ?? 0} skipped — not ours)`,
    );
  }
  if (res.success === false) {
    console.warn(
      `  WARNING: scheduled-event cleanup deleted nothing (${res.reason ?? "unknown reason"})`,
    );
  }
}

/** Pause reconciliation cron to prevent Discord API queue flooding (ROK-969). */
export async function pauseReconciliation(api: ApiClient): Promise<void> {
  await api.post("/admin/test/pause-reconciliation", {}).catch(() => null);
}

/** Disable Discord scheduled event creation for non-SE tests (ROK-969). */
export async function disableScheduledEvents(api: ApiClient): Promise<void> {
  await api.post("/admin/test/disable-scheduled-events", {}).catch(() => null);
}

/** Run the SE reconciliation cron once on demand (ROK-1347). */
export async function triggerReconciliation(api: ApiClient): Promise<void> {
  await api.post("/admin/test/trigger-reconciliation", {});
}

/** Call the operator orphan-SE recovery endpoint (ROK-1347). */
export async function recoverOrphanScheduledEvents(
  api: ApiClient,
  dryRun: boolean,
): Promise<{
  dryRun: boolean;
  guildSeCount: number;
  reclaimableDuplicates: Array<{
    eventId: number;
    seId: string;
    title: string;
  }>;
  operatorOrphans: number;
  deleted: number;
}> {
  return api.post(
    `/admin/scheduled-events/recover-orphans?dryRun=${dryRun}`,
    {},
  );
}

/** Re-enable Discord scheduled event creation for SE tests (ROK-969). */
export async function enableScheduledEvents(api: ApiClient): Promise<void> {
  await api.post("/admin/test/enable-scheduled-events", {});
}

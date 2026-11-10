/**
 * Hides retired plugin cron rows (ROK-2163).
 *
 * A plugin that stops registering a job leaves its `cron_jobs` row behind:
 * the sync only upserts. Deleting the row (and its run history) is the
 * operator's call, so instead the admin API hides it. A plugin-source row is
 * "retired" when its plugin's registrar was synced successfully on the latest
 * sync and its name is not in that registrar's job list. Rows of plugins whose
 * registrar was not synced (inactive, or it threw) and core rows are never
 * retired.
 */
import type * as schema from '../drizzle/schema';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type RetirableRow = Pick<CronJobRow, 'name' | 'source' | 'pluginSlug'>;

export class RetiredPluginJobs {
  /** Live job names per plugin slug, from the latest completed sync. */
  private liveBySlug = new Map<string, ReadonlySet<string>>();

  /** Replace the live-name map once a full plugin sync has finished. */
  replace(liveBySlug: Map<string, ReadonlySet<string>>): void {
    this.liveBySlug = liveBySlug;
  }

  /** True when no plugin registrar has been synced yet (nothing to hide). */
  get isEmpty(): boolean {
    return this.liveBySlug.size === 0;
  }

  /** True when the row belongs to a synced plugin that no longer lists it. */
  isRetired(row: RetirableRow): boolean {
    if (row.source !== 'plugin' || !row.pluginSlug) return false;
    const live = this.liveBySlug.get(row.pluginSlug);
    return live !== undefined && !live.has(row.name);
  }
}

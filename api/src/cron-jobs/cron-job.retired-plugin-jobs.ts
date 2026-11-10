/**
 * Hides retired plugin cron rows (ROK-2163).
 *
 * A plugin that stops registering a job leaves its `cron_jobs` row behind:
 * the sync only upserts. Deleting the row (and its run history) is the
 * operator's call, so instead the admin API hides it. A plugin-source row is
 * "retired" when its plugin's registrar was synced successfully on the latest
 * sync and its name is not in that registrar's job list. Rows of plugins whose
 * registrar was not synced (inactive, or it threw) and core rows are never
 * retired. A plugin-named job in the SchedulerRegistry (a `@Cron('slug:x')`
 * outside the registrar) counts as live too (ROK-2162).
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

/** The plugin slug of a plugin-named scheduler job (`slug:x`, not `core:`). */
function pluginSlugOf(name: string): string | null {
  if (!name.includes(':') || name.startsWith('core:')) return null;
  return name.slice(0, name.indexOf(':'));
}

/**
 * Add the plugin-named SchedulerRegistry jobs to the registrars' live names,
 * for plugins whose registrar was synced (others are never hidden anyway).
 */
export function withRegistryPluginJobs(
  liveBySlug: Map<string, ReadonlySet<string>>,
  registryJobs: ReadonlyMap<string, unknown>,
): Map<string, ReadonlySet<string>> {
  const out = new Map<string, Set<string>>();
  for (const [slug, names] of liveBySlug) out.set(slug, new Set(names));
  for (const name of registryJobs.keys()) {
    const slug = pluginSlugOf(name);
    if (slug !== null) out.get(slug)?.add(name);
  }
  return out;
}

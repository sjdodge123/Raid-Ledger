import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  HubWidgetPrefsSchema,
  UpdateHubWidgetPrefsSchema,
  type HubWidgetPrefs,
  type HubWidgetPrefsResponse,
} from '@raid-ledger/contract';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { GuildActor } from './guild-access.service';
import { findGuild } from './guild-core.queries';
import { HUB_NOT_FOUND } from './hub-hidden.helpers';
import { findProfileRow, upsertProfile } from './guild-profile.queries';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The hub's saved Overview layout, or `null` (registry default). A stored
 * blob that no longer parses (schema tightened since it was written) reads
 * as `null` rather than breaking the page; the next Save overwrites it.
 */
export async function readWidgetPrefs(
  db: Db,
  guildId: number,
): Promise<HubWidgetPrefs | null> {
  const row = await findProfileRow(db, guildId);
  if (!row || row.widgetPrefs === null) return null;
  const parsed = HubWidgetPrefsSchema.safeParse(row.widgetPrefs);
  return parsed.success ? parsed.data : null;
}

/** Audit metadata: what changed in size, never the ids or config text. */
export function auditMetadata(
  prefs: HubWidgetPrefs | null,
): Record<string, unknown> {
  if (prefs === null) return { reset: true };
  return {
    reset: false,
    order: prefs.order.length,
    hidden: prefs.hidden.length,
    added: prefs.added.length,
    configured: Object.keys(prefs.config).length,
  };
}

/**
 * ROK-1918 — arrange mode for the hub Overview. Access (leader / officer /
 * staff) is enforced by `GuildEditorGuard` on the route; this service only
 * parses, stores the layout whole on `guild_profiles.widget_prefs` (creating
 * the row if the hub has none) and writes the audit row. Last write wins.
 * A missing hub id 404s before the upsert (the guards let a missing guild
 * through to the handler; the profile FK would otherwise surface as a 500).
 */
@Injectable()
export class HubWidgetPrefsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: Db,
    private readonly activity: ActivityLogService,
  ) {}

  get(guildId: number): Promise<HubWidgetPrefs | null> {
    return readWidgetPrefs(this.db, guildId);
  }

  /** Save a full layout, or `{ reset: true }` to store `null`. */
  async update(
    actor: GuildActor,
    guildId: number,
    body: unknown,
  ): Promise<HubWidgetPrefsResponse> {
    const parsed = UpdateHubWidgetPrefsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const widgetPrefs = 'reset' in parsed.data ? null : parsed.data;
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException(HUB_NOT_FOUND);
    }
    await upsertProfile(this.db, guildId, {
      widgetPrefs,
      updatedAt: new Date(),
    });
    await this.activity.log(
      'hub',
      guildId,
      'hub_widget_layout_updated',
      actor.id,
      auditMetadata(widgetPrefs),
    );
    return { widgetPrefs };
  }
}

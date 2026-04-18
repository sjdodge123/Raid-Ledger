/**
 * Resolves the Discord channel for lineup embeds (ROK-932).
 * Falls back from dedicated lineup channel to announcement channel.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Lineup metadata pulled from the DB for embed context (ROK-1063). */
export interface LineupMeta {
  title?: string;
  description?: string | null;
}

/** Load title + description for a lineup (ROK-1063). */
export async function loadLineupMeta(
  db: Db,
  lineupId: number,
): Promise<LineupMeta> {
  const [row] = await db
    .select({
      title: schema.communityLineups.title,
      description: schema.communityLineups.description,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  return { title: row?.title, description: row?.description ?? null };
}

/**
 * Resolve the channel ID for posting lineup embeds.
 * Priority: admin-configured lineup channel -> default announcement channel -> null.
 *
 * @param settingsService - The application settings service
 * @returns The resolved channel ID, or null if none configured
 */
export async function resolveLineupChannel(
  settingsService: SettingsService,
): Promise<string | null> {
  const lineupChannel = await settingsService.get(
    SETTING_KEYS.DISCORD_BOT_LINEUP_CHANNEL,
  );
  if (lineupChannel) return lineupChannel;

  return settingsService.getDiscordBotDefaultChannel();
}

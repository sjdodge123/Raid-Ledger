import { and, eq, isNull } from 'drizzle-orm';
import type { AddonLootExport } from '@raid-ledger/contract';
import { guildMembers, guilds } from '../../../drizzle/schema';
import { inLatestSnapshot } from '../guilds/guild-membership.helpers';
import { assertExporterInGuild } from './addon-import-guild.apply';
import { AddonImportError } from './addon-import.errors';
import {
  guildNameKey,
  type AddonApplyContext,
} from './addon-import-apply.types';

/**
 * ROK-2184 review #2 — loot is filed under the exporter's self-declared
 * `who.guildName`, so it gets the guild section's check: the exporter's GUID
 * must be on that guild's roster, else `NOT_IN_GUILD` (`assertExporterInGuild`).
 *
 * Roster source, in order:
 * 1. The same paste's guild section for that guild (`ctx.pasteGuild`) — the
 *    exact roster `assertExporterInGuild` checks, whatever the paste order,
 *    and the only roster a preview of a first-ever guild import has.
 * 2. Otherwise the stored realm-less guild `applyGuild` writes, members in
 *    its latest snapshot (`inLatestSnapshot`). No stored guild = no roster to
 *    appear in = `NOT_IN_GUILD` (fail closed, like an empty roster).
 *
 * Unguilded loot (no `who.guildName`, key '') is not checked.
 */
export async function assertLootExporterInGuild(
  ctx: AddonApplyContext,
  payload: AddonLootExport,
): Promise<void> {
  const key = guildNameKey(payload.who.guildName);
  if (key === '') return;
  const pasted = ctx.pasteGuild;
  if (pasted && guildNameKey(pasted.data.name) === key) {
    assertExporterInGuild(pasted);
    return;
  }
  if (!(await onStoredRoster(ctx, key, payload.who.guid))) {
    throw new AddonImportError('NOT_IN_GUILD');
  }
}

/** The exporter's GUID is in the stored guild's latest snapshot. */
async function onStoredRoster(
  ctx: AddonApplyContext,
  key: string,
  guid: string,
): Promise<boolean> {
  const [row] = await ctx.tx
    .select({ id: guildMembers.id })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(
      and(
        eq(guilds.gameId, ctx.gameId),
        eq(guilds.region, ctx.region),
        eq(guilds.nameKey, key),
        isNull(guilds.realmSlug),
        eq(guilds.kind, 'wow_guild'),
        eq(guildMembers.guid, guid),
        inLatestSnapshot(),
      ),
    )
    .limit(1);
  return row !== undefined;
}

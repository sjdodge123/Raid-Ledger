import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GuildBlizzardRosterUpdateSchema,
  type GuildBlizzardRosterView,
  type GuildSummary,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  findHubGuild,
  hubSummaryFor,
  type HubGuildRow,
} from '../../../guilds/guild-core.queries';
import { SettingsService } from '../../../settings/settings.service';
import type { AddonImportTx } from '../addon-import/addon-import-apply.types';
import { lockGuildName } from '../addon-import/addon-import.locks';
import {
  FOREVER_ARMORY_OFF_MESSAGE,
  isForeverArmoryImportEnabled,
} from '../forever-armory-switch';
import {
  blizzardRosterFor,
  isForeverGuildHub,
  slugifyGuildName,
} from './guild-slug.helpers';

/**
 * ROK-1928 A2 — sets (or clears) the Blizzard guild slug a WoW: Forever
 * guild hub's roster syncs from. Editors only (the controller's guards).
 */
@Injectable()
export class GuildBlizzardRosterService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Store `guildSlug` (null = stop syncing). A changed slug clears the last
   * sync's status, which described the old slug.
   * @throws BadRequestException invalid body
   * @throws NotFoundException not a Forever `wow_guild` hub
   * @throws ForbiddenException the Forever Armory kill switch is off
   */
  async setSlug(guildId: number, body: unknown): Promise<GuildSummary> {
    const parsed = GuildBlizzardRosterUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const hub = await this.findForeverHub(guildId);
    if (!(await isForeverArmoryImportEnabled(this.settings))) {
      throw new ForbiddenException(FOREVER_ARMORY_OFF_MESSAGE);
    }
    const guild = await this.write(hub.guild, parsed.data.guildSlug);
    return this.summary({ guild, gameSlug: hub.gameSlug });
  }

  /**
   * The stored slug + last sync outcome and a slug suggested from the guild
   * name (the settings input's prefill). Any hub-visible member may read it.
   * @throws NotFoundException not a Forever `wow_guild` hub
   */
  async getRoster(guildId: number): Promise<GuildBlizzardRosterView> {
    const { guild } = await this.findForeverHub(guildId);
    return {
      guildSlug: guild.guildSlug,
      status: guild.blizzardRosterStatus,
      syncedAt: guild.blizzardRosterSyncedAt?.toISOString() ?? null,
      suggestedSlug: slugifyGuildName(guild.name),
    };
  }

  private async findForeverHub(guildId: number): Promise<HubGuildRow> {
    const hub = await findHubGuild(this.db, guildId);
    if (!hub || !isForeverGuildHub(hub.guild.kind, hub.gameSlug)) {
      throw new NotFoundException('WoW: Forever guild not found');
    }
    return hub;
  }

  /**
   * Under the roster sync's guild lock (Codex P2-2), so a slug change waits
   * for a running sync to commit, and a sync that runs after re-reads the
   * new slug and bails.
   */
  private async write(
    current: schema.GuildSelect,
    guildSlug: string | null,
  ): Promise<schema.GuildSelect> {
    const { gameId, region, nameKey } = current;
    return this.db.transaction(async (tx) => {
      await lockGuildName(tx, gameId, region, nameKey);
      return this.writeSlug(tx, current, guildSlug);
    });
  }

  private async writeSlug(
    tx: AddonImportTx,
    current: schema.GuildSelect,
    guildSlug: string | null,
  ): Promise<schema.GuildSelect> {
    const changed = current.guildSlug !== guildSlug;
    const [row] = await tx
      .update(schema.guilds)
      .set({
        guildSlug,
        updatedAt: new Date(),
        ...(changed
          ? { blizzardRosterStatus: null, blizzardRosterSyncedAt: null }
          : {}),
      })
      .where(eq(schema.guilds.id, current.id))
      .returning();
    if (!row) throw new NotFoundException('WoW: Forever guild not found');
    return row;
  }

  private summary(hub: HubGuildRow): GuildSummary {
    return {
      ...hubSummaryFor(hub, false),
      ...blizzardRosterFor(hub.guild, hub.gameSlug),
    };
  }
}

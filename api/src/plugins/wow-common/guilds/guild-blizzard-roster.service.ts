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
import {
  FOREVER_ARMORY_OFF_MESSAGE,
  isForeverArmoryImportEnabled,
} from '../forever-armory-switch';
import { blizzardRosterFor, isForeverGuildHub } from './guild-slug.helpers';

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

  private async findForeverHub(guildId: number): Promise<HubGuildRow> {
    const hub = await findHubGuild(this.db, guildId);
    if (!hub || !isForeverGuildHub(hub.guild.kind, hub.gameSlug)) {
      throw new NotFoundException('WoW: Forever guild not found');
    }
    return hub;
  }

  private async write(
    current: schema.GuildSelect,
    guildSlug: string | null,
  ): Promise<schema.GuildSelect> {
    const changed = current.guildSlug !== guildSlug;
    const [row] = await this.db
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

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { EventGuildTagger } from '../../plugin-host/extension-points';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { GuildAccessService, type GuildActor } from './guild-access.service';

/**
 * ROK-1787 P2: the WoW answer to "may this actor tag an event to this guild?".
 * Rights come from `GuildAccessService.canEdit` only (staff or an
 * admin-assigned guild_editors grant — the GM has no implicit rights).
 */
@Injectable()
export class GuildEventTagger implements EventGuildTagger {
  readonly pluginSlug = WOW_COMMON_MANIFEST.id;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  async assertCanTag(
    actor: GuildActor,
    guildId: number,
    gameId: number | null,
  ): Promise<void> {
    const [guild] = await this.db
      .select({ gameId: schema.guilds.gameId })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);
    if (!guild) throw new BadRequestException('Guild not found');
    if (gameId === null || guild.gameId !== gameId) {
      throw new BadRequestException('Guild belongs to a different game');
    }
    if (!(await this.access.canEdit(actor, guildId))) {
      throw new ForbiddenException(
        'Only a guild editor can tag events to this guild',
      );
    }
  }
}

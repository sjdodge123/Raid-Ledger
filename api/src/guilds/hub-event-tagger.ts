import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { EventGuildTagger } from '../plugins/plugin-host/extension-points';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import { HubKindRegistry } from './hub-kind.registry';

/** Kept verbatim from the ROK-1787 WoW tagger (events' API contract). */
const GUILD_NOT_FOUND = 'Guild not found';
const GAME_MISMATCH = 'Guild belongs to a different game';
const TAGGING_UNAVAILABLE = 'Guild tagging is unavailable';

/**
 * ROK-1831 Q2 — the kind-agnostic answer to "may this actor tag an event to
 * this hub?", moved out of the WoW plugin. The hub's kind must have a live
 * adapter (owner plugin active), the event's game must be the hub's game,
 * and the actor must be a Leader/Officer (`GuildAccessService.canEdit`).
 */
@Injectable()
export class HubEventTagger implements EventGuildTagger {
  readonly pluginSlug = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  async assertCanTag(
    actor: GuildActor,
    guildId: number,
    gameId: number | null,
  ): Promise<void> {
    const [guild] = await this.db
      .select({ gameId: schema.guilds.gameId, kind: schema.guilds.kind })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);
    if (!guild) throw new BadRequestException(GUILD_NOT_FOUND);
    if (this.hubKinds.resolve(guild.kind) === undefined) {
      throw new BadRequestException(TAGGING_UNAVAILABLE);
    }
    if (gameId === null || guild.gameId !== gameId) {
      throw new BadRequestException(GAME_MISMATCH);
    }
    if (!(await this.access.canEdit(actor, guildId))) {
      throw new ForbiddenException(
        'Only a guild editor can tag events to this guild',
      );
    }
  }
}

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateEventDto,
  UpdateEventDto,
  UserRole,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EVENT_GUILD_TAGGER_KEY,
  EXTENSION_POINTS,
  type EventGuildTagger,
} from '../plugins/plugin-host/extension-points';

type Actor = { id: number; role: UserRole };

export const GUILD_TAGGING_UNAVAILABLE = 'Guild tagging is unavailable';
export const GUILD_GAME_MISMATCH = 'Guild belongs to a different game';

/**
 * ROK-1787: core gate for `events.guild_id`. Who may tag an event to a guild
 * is the guild plugin's call (EVENT_GUILD_TAGGER); core never imports it.
 */
@Injectable()
export class EventGuildTagService {
  constructor(
    private readonly registry: PluginRegistryService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Create: a guildId is checked against the new event's game. */
  async assertCreate(actor: Actor, dto: CreateEventDto): Promise<void> {
    if (dto.guildId === undefined) return;
    await this.assertCanTag(actor, dto.guildId, dto.gameId ?? null);
  }

  /**
   * Update (single or series): a number re-checks rights against the
   * resulting game; null clears with no guild check; a game change that would
   * leave the existing tag on another game is refused.
   */
  async assertUpdate(
    actor: Actor,
    eventId: number,
    dto: UpdateEventDto,
  ): Promise<void> {
    if (dto.guildId === null) return;
    if (dto.guildId === undefined && dto.gameId === undefined) return;
    const existing = await this.loadTag(eventId);
    if (!existing) return; // the event service answers 404
    const gameId = dto.gameId !== undefined ? dto.gameId : existing.gameId;
    if (dto.guildId !== undefined) {
      await this.assertCanTag(actor, dto.guildId, gameId);
    } else if (existing.guildId !== null && gameId !== existing.gameId) {
      throw new BadRequestException(GUILD_GAME_MISMATCH);
    }
  }

  async assertCanTag(
    actor: Actor,
    guildId: number,
    gameId: number | null,
  ): Promise<void> {
    const tagger = this.registry.getAdapter<EventGuildTagger>(
      EXTENSION_POINTS.EVENT_GUILD_TAGGER,
      EVENT_GUILD_TAGGER_KEY,
    );
    if (!tagger || !this.registry.isActive(tagger.pluginSlug)) {
      throw new BadRequestException(GUILD_TAGGING_UNAVAILABLE);
    }
    await tagger.assertCanTag(
      { id: actor.id, role: actor.role },
      guildId,
      gameId,
    );
  }

  private async loadTag(
    eventId: number,
  ): Promise<{ gameId: number | null; guildId: number | null } | undefined> {
    const [row] = await this.db
      .select({
        gameId: schema.events.gameId,
        guildId: schema.events.guildId,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return row;
  }
}

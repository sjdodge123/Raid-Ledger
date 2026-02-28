import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type {
  BindingPurpose,
  ChannelType,
  ChannelBindingConfig,
} from '@raid-ledger/contract';

export interface BindingRecord {
  id: string;
  guildId: string;
  channelId: string;
  channelType: string;
  bindingPurpose: string;
  gameId: number | null;
  recurrenceGroupId: string | null;
  config: ChannelBindingConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ChannelBindingsService {
  private readonly logger = new Logger(ChannelBindingsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Create or update a channel binding.
   * Uses upsert: if a binding already exists for the same guild+channel+series, it is replaced.
   * ROK-435: Added recurrenceGroupId for series-specific bindings.
   */
  async bind(
    guildId: string,
    channelId: string,
    channelType: ChannelType,
    bindingPurpose: BindingPurpose,
    gameId: number | null,
    config?: ChannelBindingConfig,
    recurrenceGroupId?: string | null,
  ): Promise<{ binding: BindingRecord; replacedChannelIds: string[] }> {
    // ROK-435: If binding a series, remove any existing binding for the same
    // series in this guild (regardless of channel) so a series has at most one
    // channel binding. Return old channel IDs so the caller can warn the user.
    let replacedChannelIds: string[] = [];
    if (recurrenceGroupId) {
      const deleted = await this.db
        .delete(schema.channelBindings)
        .where(
          and(
            eq(schema.channelBindings.guildId, guildId),
            eq(schema.channelBindings.recurrenceGroupId, recurrenceGroupId),
            isNotNull(schema.channelBindings.recurrenceGroupId),
          ),
        )
        .returning({ channelId: schema.channelBindings.channelId });

      // Only flag channels that differ from the new target
      replacedChannelIds = deleted
        .map((d) => d.channelId)
        .filter((id) => id !== channelId);
    }

    const [result] = await this.db
      .insert(schema.channelBindings)
      .values({
        guildId,
        channelId,
        channelType,
        bindingPurpose,
        gameId,
        recurrenceGroupId: recurrenceGroupId ?? null,
        config: config ?? {},
      })
      .onConflictDoUpdate({
        target: [
          schema.channelBindings.guildId,
          schema.channelBindings.channelId,
          schema.channelBindings.recurrenceGroupId,
        ],
        set: {
          channelType,
          bindingPurpose,
          gameId,
          config: config ?? {},
          updatedAt: new Date(),
        },
      })
      .returning();

    this.logger.log(
      `Bound channel ${channelId} in guild ${guildId} as ${bindingPurpose}` +
        (recurrenceGroupId ? ` (series: ${recurrenceGroupId})` : ''),
    );

    return { binding: result as BindingRecord, replacedChannelIds };
  }

  /**
   * Remove a channel binding.
   * ROK-435: If recurrenceGroupId is provided, only the series binding is removed.
   * Otherwise removes bindings without a series (game-level bindings).
   */
  async unbind(
    guildId: string,
    channelId: string,
    recurrenceGroupId?: string | null,
  ): Promise<boolean> {
    const conditions = [
      eq(schema.channelBindings.guildId, guildId),
      eq(schema.channelBindings.channelId, channelId),
    ];

    if (recurrenceGroupId) {
      conditions.push(
        eq(schema.channelBindings.recurrenceGroupId, recurrenceGroupId),
      );
    } else {
      conditions.push(sql`${schema.channelBindings.recurrenceGroupId} IS NULL`);
    }

    const result = await this.db
      .delete(schema.channelBindings)
      .where(and(...conditions))
      .returning();

    if (result.length > 0) {
      this.logger.log(
        `Unbound channel ${channelId} in guild ${guildId}` +
          (recurrenceGroupId ? ` (series: ${recurrenceGroupId})` : ''),
      );
      return true;
    }

    return false;
  }

  /**
   * Get all bindings for a guild.
   */
  async getBindings(guildId: string): Promise<BindingRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.guildId, guildId));

    return rows as BindingRecord[];
  }

  /**
   * Get all bindings for a guild with game names joined from the games table.
   */
  async getBindingsWithGameNames(
    guildId: string,
  ): Promise<(BindingRecord & { gameName: string | null })[]> {
    const rows = await this.db
      .select({
        id: schema.channelBindings.id,
        guildId: schema.channelBindings.guildId,
        channelId: schema.channelBindings.channelId,
        channelType: schema.channelBindings.channelType,
        bindingPurpose: schema.channelBindings.bindingPurpose,
        gameId: schema.channelBindings.gameId,
        recurrenceGroupId: schema.channelBindings.recurrenceGroupId,
        config: schema.channelBindings.config,
        createdAt: schema.channelBindings.createdAt,
        updatedAt: schema.channelBindings.updatedAt,
        gameName: schema.games.name,
      })
      .from(schema.channelBindings)
      .leftJoin(
        schema.games,
        eq(schema.channelBindings.gameId, schema.games.id),
      )
      .where(eq(schema.channelBindings.guildId, guildId));

    return rows as (BindingRecord & { gameName: string | null })[];
  }

  /**
   * Get a specific binding by ID.
   */
  async getBindingById(id: string): Promise<BindingRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.id, id))
      .limit(1);

    return (row as BindingRecord) ?? null;
  }

  /**
   * Get the channel binding for a specific game in a guild.
   * Used for event routing: game-specific binding takes priority over default channel.
   */
  async getChannelForGame(
    guildId: string,
    gameId: number,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ channelId: schema.channelBindings.channelId })
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.guildId, guildId),
          eq(schema.channelBindings.gameId, gameId),
          eq(schema.channelBindings.bindingPurpose, 'game-announcements'),
        ),
      )
      .limit(1);

    return row?.channelId ?? null;
  }

  /**
   * Get the channel binding for a specific recurrence group (event series) in a guild.
   * ROK-435: Series-specific binding takes priority over game-specific binding.
   */
  async getChannelForSeries(
    guildId: string,
    recurrenceGroupId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ channelId: schema.channelBindings.channelId })
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.guildId, guildId),
          eq(schema.channelBindings.recurrenceGroupId, recurrenceGroupId),
          eq(schema.channelBindings.bindingPurpose, 'game-announcements'),
        ),
      )
      .limit(1);

    return row?.channelId ?? null;
  }

  /**
   * Get the voice channel binding for a specific game (or any game) in a guild.
   * Used for invite DMs to show the correct voice channel to join.
   * Priority: game-specific voice → any voice monitor binding.
   */
  async getVoiceChannelForGame(
    guildId: string,
    gameId?: number | null,
  ): Promise<string | null> {
    // Try game-specific voice binding first
    if (gameId) {
      const [gameRow] = await this.db
        .select({ channelId: schema.channelBindings.channelId })
        .from(schema.channelBindings)
        .where(
          and(
            eq(schema.channelBindings.guildId, guildId),
            eq(schema.channelBindings.gameId, gameId),
            eq(schema.channelBindings.bindingPurpose, 'game-voice-monitor'),
          ),
        )
        .limit(1);

      if (gameRow) return gameRow.channelId;
    }

    // Fall back to any voice monitor binding (all-games)
    const [anyRow] = await this.db
      .select({ channelId: schema.channelBindings.channelId })
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.guildId, guildId),
          eq(schema.channelBindings.bindingPurpose, 'game-voice-monitor'),
        ),
      )
      .limit(1);

    return anyRow?.channelId ?? null;
  }

  /**
   * Update binding config fields (min players, grace period, etc.).
   */
  async updateConfig(
    id: string,
    config: Partial<ChannelBindingConfig>,
    bindingPurpose?: BindingPurpose,
  ): Promise<BindingRecord | null> {
    const existing = await this.getBindingById(id);
    if (!existing) return null;

    const mergedConfig = { ...(existing.config ?? {}), ...config };

    const updateSet: Partial<typeof schema.channelBindings.$inferInsert> = {
      config: mergedConfig,
      updatedAt: new Date(),
    };

    if (bindingPurpose) {
      updateSet.bindingPurpose = bindingPurpose;
    }

    const [result] = await this.db
      .update(schema.channelBindings)
      .set(updateSet)
      .where(eq(schema.channelBindings.id, id))
      .returning();

    return (result as BindingRecord) ?? null;
  }

  /**
   * Smart behavior detection based on channel type and binding context.
   * Text channels default to game-announcements.
   * Voice channels: game-voice-monitor if a game is specified, general-lobby if not.
   */
  detectBehavior(
    channelType: ChannelType,
    gameId?: number | null,
  ): BindingPurpose {
    switch (channelType) {
      case 'voice':
        return gameId ? 'game-voice-monitor' : 'general-lobby';
      case 'text':
      default:
        return 'game-announcements';
    }
  }
}

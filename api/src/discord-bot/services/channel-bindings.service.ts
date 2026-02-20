import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
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
   * Uses upsert: if a binding already exists for the same guild+channel, it is replaced.
   */
  async bind(
    guildId: string,
    channelId: string,
    channelType: ChannelType,
    bindingPurpose: BindingPurpose,
    gameId: number | null,
    config?: ChannelBindingConfig,
  ): Promise<BindingRecord> {
    const [result] = await this.db
      .insert(schema.channelBindings)
      .values({
        guildId,
        channelId,
        channelType,
        bindingPurpose,
        gameId,
        config: config ?? {},
      })
      .onConflictDoUpdate({
        target: [
          schema.channelBindings.guildId,
          schema.channelBindings.channelId,
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
      `Bound channel ${channelId} in guild ${guildId} as ${bindingPurpose}`,
    );

    return result as BindingRecord;
  }

  /**
   * Remove a channel binding.
   */
  async unbind(guildId: string, channelId: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.guildId, guildId),
          eq(schema.channelBindings.channelId, channelId),
        ),
      )
      .returning();

    if (result.length > 0) {
      this.logger.log(`Unbound channel ${channelId} in guild ${guildId}`);
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

    const updateSet: Record<string, unknown> = {
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
   * Text channels default to game-announcements, voice channels to game-voice-monitor.
   */
  detectBehavior(channelType: ChannelType): BindingPurpose {
    switch (channelType) {
      case 'voice':
        return 'game-voice-monitor';
      case 'text':
      default:
        return 'game-announcements';
    }
  }
}

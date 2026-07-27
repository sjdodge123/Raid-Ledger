import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  assertNoBindingConflict,
  cleanupSeriesBindings,
  findExistingBinding,
  mappingConflicts,
} from './channel-bindings-uniqueness.helpers';
import {
  assertResolvedUpdateTriple,
  assertUpsertTriple,
  detectBehavior,
} from './channel-bindings-invariant.helpers';
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

interface UpsertBindingOpts {
  guildId: string;
  channelId: string;
  channelType: ChannelType;
  bindingPurpose: BindingPurpose;
  gameId: number | null;
  config?: ChannelBindingConfig;
  recurrenceGroupId?: string | null;
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
    const replacedChannelIds = await cleanupSeriesBindings(
      this.db,
      guildId,
      channelId,
      channelType,
      recurrenceGroupId,
    );
    const binding = await this.upsertBinding({
      guildId,
      channelId,
      channelType,
      bindingPurpose,
      gameId,
      config,
      recurrenceGroupId,
    });
    this.logger.log(
      `Bound channel ${channelId} in guild ${guildId} as ${bindingPurpose}` +
        (recurrenceGroupId ? ` (series: ${recurrenceGroupId})` : ''),
    );
    return { binding, replacedChannelIds };
  }

  /**
   * Insert or update a channel binding row.
   * Uses manual SELECT → INSERT/UPDATE instead of ON CONFLICT because the
   * unique index includes nullable columns where NULL != NULL in PostgreSQL.
   * Matches on (guild, channel, series, game) to support multiple
   * game-specific bindings per channel (ROK-842). findExistingBinding stays
   * WIDER than the DB key on purpose (ROK-1419 D3(7)); mappingConflicts maps a
   * 23505 from either partial unique index to a 409.
   */
  private async upsertBinding(opts: UpsertBindingOpts): Promise<BindingRecord> {
    // ROK-1415: covers BOTH branches — the UPDATE branch never writes gameId,
    // and findExistingBinding matches on gameId, so opts.gameId IS the stored
    // value there. This closes the second, undocumented route into the inert
    // (voice, game-voice-monitor, NULL) triple.
    assertUpsertTriple(opts);
    const existing = await findExistingBinding(this.db, opts);
    if (existing) {
      const [result] = await mappingConflicts(() =>
        this.db
          .update(schema.channelBindings)
          .set({
            channelType: opts.channelType,
            bindingPurpose: opts.bindingPurpose,
            config: opts.config ?? {},
            updatedAt: new Date(),
          })
          .where(eq(schema.channelBindings.id, existing.id))
          .returning(),
      );
      return result;
    }
    const [result] = await mappingConflicts(() =>
      this.db
        .insert(schema.channelBindings)
        .values({
          guildId: opts.guildId,
          channelId: opts.channelId,
          channelType: opts.channelType,
          bindingPurpose: opts.bindingPurpose,
          gameId: opts.gameId,
          recurrenceGroupId: opts.recurrenceGroupId ?? null,
          config: opts.config ?? {},
        })
        .returning(),
    );
    return result;
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
   * Remove a SINGLE binding by id (ROK-1419). The admin Remove button uses this
   * so deleting one binding never drops a sibling on the same channel — contrast
   * unbind(), which deletes EVERY non-series binding on the channel.
   */
  async unbindById(id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.channelBindings)
      .where(eq(schema.channelBindings.id, id))
      .returning();
    return result.length > 0;
  }

  /**
   * Get all bindings for a guild.
   */
  async getBindings(guildId: string): Promise<BindingRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.channelBindings)
      .where(eq(schema.channelBindings.guildId, guildId));

    return rows;
  }

  /**
   * Get all bindings for a guild with game names joined from the games table.
   */
  async getBindingsWithGameNames(
    guildId: string,
  ): Promise<(BindingRecord & { gameName: string | null })[]> {
    const b = schema.channelBindings;
    const rows = await this.db
      .select({
        id: b.id,
        guildId: b.guildId,
        channelId: b.channelId,
        channelType: b.channelType,
        bindingPurpose: b.bindingPurpose,
        gameId: b.gameId,
        recurrenceGroupId: b.recurrenceGroupId,
        config: b.config,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        gameName: schema.games.name,
      })
      .from(b)
      .leftJoin(schema.games, eq(b.gameId, schema.games.id))
      .where(eq(b.guildId, guildId));
    return rows;
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

    return row ?? null;
  }

  /** Shared single-channel lookup by arbitrary conditions. */
  private async findChannel(
    ...conditions: ReturnType<typeof eq>[]
  ): Promise<string | null> {
    const cb = schema.channelBindings;
    const [row] = await this.db
      .select({ channelId: cb.channelId })
      .from(cb)
      .where(and(...conditions))
      .limit(1);
    return row?.channelId ?? null;
  }

  /** Game-specific text binding (event routing). */
  async getChannelForGame(
    guildId: string,
    gameId: number,
  ): Promise<string | null> {
    const cb = schema.channelBindings;
    return this.findChannel(
      eq(cb.guildId, guildId),
      eq(cb.gameId, gameId),
      eq(cb.bindingPurpose, 'game-announcements'),
    );
  }

  /** Series-specific text binding — priority over game-specific (ROK-435). */
  async getChannelForSeries(
    guildId: string,
    recurrenceGroupId: string,
  ): Promise<string | null> {
    const cb = schema.channelBindings;
    return this.findChannel(
      eq(cb.guildId, guildId),
      eq(cb.recurrenceGroupId, recurrenceGroupId),
      eq(cb.bindingPurpose, 'game-announcements'),
    );
  }

  /** Game-specific voice binding — callers fall back to app-setting default (ROK-592). */
  async getVoiceChannelForGame(
    guildId: string,
    gameId?: number | null,
  ): Promise<string | null> {
    if (!gameId) return null;
    const cb = schema.channelBindings;
    return this.findChannel(
      eq(cb.guildId, guildId),
      eq(cb.gameId, gameId),
      eq(cb.bindingPurpose, 'game-voice-monitor'),
    );
  }

  /** Series voice binding — filters by channelType since series may be 'general-lobby' (ROK-599). */
  async getVoiceChannelForSeries(
    guildId: string,
    recurrenceGroupId: string,
  ): Promise<string | null> {
    const cb = schema.channelBindings;
    return this.findChannel(
      eq(cb.guildId, guildId),
      eq(cb.recurrenceGroupId, recurrenceGroupId),
      eq(cb.channelType, 'voice'),
    );
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
    // ROK-1415: assert the RESOLVED post-write triple. When ROK-1416 threads a
    // gameId through this method, it must resolve into this same call — the
    // guard sits downstream of any future field, by design.
    assertResolvedUpdateTriple(existing, { bindingPurpose }, id);
    // ROK-1419: reject a purpose flip into an already-occupied non-series slot
    // with the operator message before the write; the DB index is the backstop.
    await assertNoBindingConflict(this.db, existing, bindingPurpose);
    const updateSet: Partial<typeof schema.channelBindings.$inferInsert> = {
      config: { ...(existing.config ?? {}), ...config },
      updatedAt: new Date(),
      ...(bindingPurpose && { bindingPurpose }),
    };
    const [result] = await mappingConflicts(() =>
      this.db
        .update(schema.channelBindings)
        .set(updateSet)
        .where(eq(schema.channelBindings.id, id))
        .returning(),
    );
    return result ?? null;
  }

  /**
   * Check whether a game with the given ID exists in the games table.
   */
  async gameExists(gameId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    return !!row;
  }

  /**
   * Smart behavior detection — delegates to the contract's canonical
   * deriveBindingPurpose (ROK-1415). Note the intentional behaviour correction:
   * gameId === 0 now derives game-voice-monitor (`!= null`, not truthiness).
   */
  detectBehavior(
    channelType: ChannelType,
    gameId?: number | null,
  ): BindingPurpose {
    return detectBehavior(channelType, gameId);
  }
}

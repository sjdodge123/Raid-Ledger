import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  EXTENSION_POINTS,
  type GameActivityAttributionAdapter,
} from '../plugin-host/extension-points';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from './manifest';
import {
  WOW_ANNIVERSARY_SLUG,
  WOW_FOREVER_SLUG,
  attributeClassicPlay,
  isAmbiguousClassicName,
  type ClassicFamilyCharacter,
  type ClassicGameIds,
} from './classic-activity-attribution.helpers';
import {
  hasOpenVoiceClassicSession,
  uncreditOpenRawClassicSessions,
} from './classic-activity-overlap.helpers';

/** Game rows can be merged/renumbered: re-read the ids at most this often. */
const IDS_TTL_MS = 10 * 60_000;

/**
 * ROK-2259 — WoW-plugin adapter that re-attributes play time the registry
 * resolved to TBC Anniversary (Discord's "World of Warcraft Classic", from the
 * presence or the voice path) using the player's own characters.
 */
@Injectable()
export class ClassicActivityAttributionService
  implements GameActivityAttributionAdapter, OnModuleInit
{
  /** Cached (TTL) once both games are found; retried while either is missing. */
  private ids: ClassicGameIds | null = null;
  private idsReadAt = 0;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  /** Owned by the WoW plugin: suspended (old behaviour) while it is inactive. */
  onModuleInit(): void {
    this.pluginRegistry.registerAdapter(
      EXTENSION_POINTS.GAME_ACTIVITY_ATTRIBUTION,
      WOW_COMMON_MANIFEST.id,
      this,
      { ownerPluginId: WOW_COMMON_MANIFEST.id },
    );
  }

  /**
   * The game to credit `userId` for a session resolved to `gameId`, or `null`
   * for a raw-name presence row that duplicates an open voice row. Taking the
   * credit from the open raw presence row waits for `afterOpen`.
   */
  async attribute(
    userId: number,
    gameId: number,
    discordActivityName: string,
  ): Promise<number | null> {
    const ids = await this.gameIds();
    if (!ids) return gameId;
    if (gameId === ids.anniversaryId) {
      return this.creditClassic(userId, discordActivityName, ids);
    }
    return gameId;
  }

  /**
   * A stored non-raw-name (voice) row credited to a Classic-family game takes
   * the credit from the user's open raw-name presence row. Runs only after a
   * successful insert, so a failed insert never loses both credits.
   */
  async afterOpen(
    userId: number,
    gameId: number | null,
    discordActivityName: string,
  ): Promise<void> {
    if (gameId === null || isAmbiguousClassicName(discordActivityName)) return;
    const ids = await this.gameIds();
    if (!ids) return;
    if (gameId !== ids.anniversaryId && gameId !== ids.foreverId) return;
    await uncreditOpenRawClassicSessions(this.db, userId, ids);
  }

  /**
   * Raw "World of Warcraft Classic" that resolved to no game (no mapping row):
   * same per-player rule, starting from the ambiguous Anniversary target.
   * `null` for any other name, or while either WoW game row is missing.
   */
  async attributeUnresolved(
    userId: number,
    discordActivityName: string,
  ): Promise<number | null> {
    if (!isAmbiguousClassicName(discordActivityName)) return null;
    const ids = await this.gameIds();
    if (!ids) return null;
    return this.creditClassic(userId, discordActivityName, ids);
  }

  /** Drop the cached game ids (tests; after a games merge). */
  resetCache(): void {
    this.ids = null;
  }

  /**
   * Per-player Classic credit without double counting: a raw-name row opened
   * while a voice row is open stays uncredited (the reverse is `afterOpen`).
   */
  private async creditClassic(
    userId: number,
    discordActivityName: string,
    ids: ClassicGameIds,
  ): Promise<number | null> {
    if (
      isAmbiguousClassicName(discordActivityName) &&
      (await hasOpenVoiceClassicSession(this.db, userId, ids))
    ) {
      return null;
    }
    const characters = await this.characters(userId);
    return attributeClassicPlay(ids.anniversaryId, characters, ids);
  }

  private characters(userId: number): Promise<ClassicFamilyCharacter[]> {
    return this.db
      .select({
        gameId: schema.characters.gameId,
        gameVariant: schema.characters.gameVariant,
        ruleset: schema.characters.ruleset,
      })
      .from(schema.characters)
      .where(eq(schema.characters.userId, userId));
  }

  private async gameIds(): Promise<ClassicGameIds | null> {
    if (this.ids && Date.now() - this.idsReadAt < IDS_TTL_MS) return this.ids;
    const rows = await this.db
      .select({ id: schema.games.id, slug: schema.games.slug })
      .from(schema.games)
      .where(
        inArray(schema.games.slug, [WOW_FOREVER_SLUG, WOW_ANNIVERSARY_SLUG]),
      );
    const foreverId = rows.find((r) => r.slug === WOW_FOREVER_SLUG)?.id;
    const anniversaryId = rows.find((r) => r.slug === WOW_ANNIVERSARY_SLUG)?.id;
    if (foreverId === undefined || anniversaryId === undefined) return null;
    this.ids = { foreverId, anniversaryId };
    this.idsReadAt = Date.now();
    return this.ids;
  }
}

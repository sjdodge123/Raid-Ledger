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
  type ClassicGameIds,
} from './classic-activity-attribution.helpers';

/**
 * ROK-2259 — WoW-plugin adapter that re-attributes play time the registry
 * resolved to TBC Anniversary (Discord's "World of Warcraft Classic", from the
 * presence or the voice path) using the player's own characters.
 */
@Injectable()
export class ClassicActivityAttributionService
  implements GameActivityAttributionAdapter, OnModuleInit
{
  /** Cached once both games are found; retried while either is missing. */
  private ids: ClassicGameIds | null = null;

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

  /** The game to credit `userId` for a session resolved to `gameId`. */
  async attribute(userId: number, gameId: number): Promise<number> {
    const ids = await this.gameIds();
    if (!ids || gameId !== ids.anniversaryId) return gameId;
    const characters = await this.db
      .select({
        gameId: schema.characters.gameId,
        gameVariant: schema.characters.gameVariant,
        ruleset: schema.characters.ruleset,
      })
      .from(schema.characters)
      .where(eq(schema.characters.userId, userId));
    return attributeClassicPlay(gameId, characters, ids);
  }

  private async gameIds(): Promise<ClassicGameIds | null> {
    if (this.ids) return this.ids;
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
    return this.ids;
  }
}

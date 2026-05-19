import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameDetailDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ItadService } from '../itad/itad.service';
import { IgdbService } from '../igdb/igdb.service';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { mapDbRowToDetail } from '../igdb/igdb.mappers';
import type { ItadGame } from '../itad/itad.constants';

/**
 * ROK-1295 — resolve a free-text game name to a hydrated GameDetailDto.
 *
 * Cascade:
 *   1. findGameByNormalizedName → existing row (no upsert, no external call).
 *   2. ITAD search → first match upserted via the canonical name-dedup path.
 *   3. IGDB search → first match upserted via the canonical name-dedup path.
 *   4. Both miss → 404 from the caller.
 *
 * Name-dedup STRICT (CLAUDE.md ROK-1113 / ROK-1283): every INSERT-into-games
 * path runs through findGameByNormalizedName first. Reuses the canonical
 * pattern from upsertSingleGameRow / upsertItadGame.
 */
@Injectable()
export class GamesLookupService {
  private readonly logger = new Logger(GamesLookupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly itadService: ItadService,
    private readonly igdbService: IgdbService,
  ) {}

  async lookupByName(q: string): Promise<GameDetailDto> {
    const existing = await this.findExistingByName(q);
    if (existing) return existing;

    const fromItad = await this.tryItadLookup(q);
    if (fromItad) return fromItad;

    const fromIgdb = await this.tryIgdbLookup(q);
    if (fromIgdb) return fromIgdb;

    throw new NotFoundException(`No game found for "${q}"`);
  }

  private async findExistingByName(q: string): Promise<GameDetailDto | null> {
    const match = await findGameByNormalizedName(this.db, q);
    if (!match) return null;
    return this.fetchDetailById(match.id);
  }

  private async tryItadLookup(q: string): Promise<GameDetailDto | null> {
    const hits = await this.itadService.searchGames(q, 5);
    const first = hits.find((g) => g.type === 'game') ?? hits[0];
    if (!first) return null;
    return this.upsertFromItad(first);
  }

  private async upsertFromItad(itadGame: ItadGame): Promise<GameDetailDto> {
    const steamMap = await this.itadService.lookupSteamAppIds([
      { id: itadGame.id, slug: itadGame.slug },
    ]);
    const steamAppId = steamMap.get(itadGame.id) ?? null;
    const existingId = await this.findOrInsertItadRow(itadGame, steamAppId);
    return this.fetchDetailById(existingId);
  }

  private async findOrInsertItadRow(
    itadGame: ItadGame,
    steamAppId: number | null,
  ): Promise<number> {
    const byName = await findGameByNormalizedName(this.db, itadGame.title);
    if (byName) {
      await this.mergeItadIntoRow(byName.id, itadGame, steamAppId);
      return byName.id;
    }
    const [row] = await this.db
      .insert(schema.games)
      .values({
        name: itadGame.title,
        slug: itadGame.slug || itadGame.id,
        itadGameId: itadGame.id || null,
        steamAppId,
        coverUrl: itadGame.assets?.boxart ?? null,
      })
      .returning({ id: schema.games.id });
    return row.id;
  }

  private async mergeItadIntoRow(
    id: number,
    itadGame: ItadGame,
    steamAppId: number | null,
  ): Promise<void> {
    await this.db
      .update(schema.games)
      .set({
        itadGameId: itadGame.id || null,
        steamAppId: steamAppId ?? undefined,
        coverUrl: itadGame.assets?.boxart ?? undefined,
      })
      .where(eq(schema.games.id, id));
  }

  private async tryIgdbLookup(q: string): Promise<GameDetailDto | null> {
    const result = await this.igdbService.searchGames(q);
    const first = pickFirstIgdbHit(result);
    if (!first) return null;
    return this.upsertFromIgdb(first);
  }

  private async upsertFromIgdb(hit: GameDetailDto): Promise<GameDetailDto> {
    const byName = await findGameByNormalizedName(this.db, hit.name);
    if (byName) {
      await this.applyIgdbMerge(byName.id, hit);
      return this.fetchDetailById(byName.id);
    }
    const inserted = await this.insertIgdbRow(hit);
    return this.fetchDetailById(inserted);
  }

  private async insertIgdbRow(hit: GameDetailDto): Promise<number> {
    const [row] = await this.db
      .insert(schema.games)
      .values(buildIgdbRowValues(hit))
      .returning({ id: schema.games.id });
    return row.id;
  }

  private async applyIgdbMerge(id: number, hit: GameDetailDto): Promise<void> {
    await this.db
      .update(schema.games)
      .set(buildIgdbRowValues(hit))
      .where(eq(schema.games.id, id));
  }

  private async fetchDetailById(id: number): Promise<GameDetailDto> {
    const [row] = await this.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Game ${id} disappeared during lookup`);
    }
    return mapDbRowToDetail(row);
  }
}

function pickFirstIgdbHit(result: {
  games: GameDetailDto[];
}): GameDetailDto | null {
  return result.games.length > 0 ? result.games[0] : null;
}

/**
 * Map a hydrated GameDetailDto to the full set of `games` columns IGDB can
 * populate. Used for both first-insert and update-on-merge paths so a row
 * created via /games/lookup-by-name carries the same payload it would have
 * from the regular IGDB sync (rating, releaseDate, playerCount, crossplay,
 * popularity, twitchGameId — Codex review finding P2 fix).
 */
function buildIgdbRowValues(
  hit: GameDetailDto,
): typeof schema.games.$inferInsert {
  return {
    igdbId: hit.igdbId,
    name: hit.name,
    slug: hit.slug,
    coverUrl: hit.coverUrl,
    summary: hit.summary,
    genres: hit.genres ?? [],
    gameModes: hit.gameModes ?? [],
    themes: hit.themes ?? [],
    platforms: hit.platforms ?? [],
    screenshots: hit.screenshots ?? [],
    videos: (hit.videos ?? []).map((v) => ({
      name: v.name ?? '',
      videoId: v.videoId,
    })),
    rating: hit.rating ?? null,
    aggregatedRating: hit.aggregatedRating ?? null,
    popularity: hit.popularity ?? null,
    firstReleaseDate: hit.firstReleaseDate
      ? new Date(hit.firstReleaseDate)
      : null,
    playerCount: hit.playerCount ?? null,
    twitchGameId: hit.twitchGameId ?? null,
    crossplay: hit.crossplay ?? null,
  };
}

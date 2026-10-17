/**
 * ROK-1374 (C1) — the manual install/download size write path.
 *
 * NAME-DEDUP POSTURE (STRICT, read before editing): this service is
 * UPDATE-ONLY. It never INSERTs into `games` and therefore stays outside the
 * `findGameByNormalizedName` / `withGameNameLock` guard, exactly like the
 * Co-Optimus sync documented at `drizzle/schema/games.ts`. An unknown id is a
 * 404, never an insert. If a future change makes this path create rows, it
 * MUST move inside the guard first — otherwise the next dedup migration is
 * silently undone on the next deploy.
 *
 * The figure is typed in by a human who read it on SteamDB. Nothing here
 * fetches SteamDB: it has no API and forbids scraping, and a public repo
 * cannot carry the credential that would make a scrape work (D11).
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SetInstallSizeDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';

/** What the caller gets back after a successful size write. */
export interface InstallSizeResult {
  ok: true;
  gameId: number;
  installSizeBytes: number | null;
  downloadSizeBytes: number | null;
  installSizeSource: string | null;
  installSizeUpdatedAt: string | null;
}

@Injectable()
export class InstallSizeService {
  private readonly logger = new Logger(InstallSizeService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Record a hand-entered footprint for a game.
   *
   * Community-shared by design (D8): the size of a game is the same for
   * everybody, so caching it per user would re-ask the whole roster the same
   * question and could never agree with itself. Source is stamped `manual` and
   * the timestamp is stamped now, because every rendered size carries its
   * provenance and age (AC12) — a confidently stale number is worse than none.
   */
  async setSize(
    gameId: number,
    input: SetInstallSizeDto,
    actorId: number,
  ): Promise<InstallSizeResult> {
    const now = new Date();
    const [row] = await this.db
      .update(schema.games)
      .set({
        installSizeBytes: input.installSizeBytes,
        downloadSizeBytes: input.downloadSizeBytes,
        installSizeSource: 'manual',
        installSizeUpdatedAt: now,
      })
      .where(eq(schema.games.id, gameId))
      .returning({
        id: schema.games.id,
        installSizeBytes: schema.games.installSizeBytes,
        downloadSizeBytes: schema.games.downloadSizeBytes,
        installSizeSource: schema.games.installSizeSource,
        installSizeUpdatedAt: schema.games.installSizeUpdatedAt,
      });
    if (!row) throw new NotFoundException('GAME_NOT_FOUND');
    this.logger.log(
      `game ${gameId} size set manually by user ${actorId} ` +
        `(install=${input.installSizeBytes ?? 'null'}, download=${input.downloadSizeBytes ?? 'null'})`,
    );
    return {
      ok: true,
      gameId: row.id,
      installSizeBytes: row.installSizeBytes,
      downloadSizeBytes: row.downloadSizeBytes,
      installSizeSource: row.installSizeSource,
      installSizeUpdatedAt: row.installSizeUpdatedAt?.toISOString() ?? null,
    };
  }
}

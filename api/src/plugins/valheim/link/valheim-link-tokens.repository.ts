import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimLinkTokens: tokens, pelicanServers: servers, games } = schema;

/** A token row joined to its server — for the bearer guard only. */
export interface ValheimLinkTokenLookup {
  tokenId: number;
  pelicanServerId: number;
  tokenHash: string;
  revokedAt: Date | null;
  missingSince: Date | null;
  gameSlug: string | null;
}

/** A Pelican server as the admin token endpoints see it. */
export interface ValheimLinkServerRef {
  id: number;
  gameSlug: string | null;
}

/** Token columns the admin status DTO is built from (never the hash). */
export interface ValheimLinkTokenStatusRow {
  pelicanServerId: number;
  tokenHint: string | null;
  createdAt: Date | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

const statusColumns = {
  tokenHint: tokens.tokenHint,
  createdAt: tokens.createdAt,
  rotatedAt: tokens.rotatedAt,
  revokedAt: tokens.revokedAt,
  lastUsedAt: tokens.lastUsedAt,
};

/** Data access for `valheim_link_tokens` (ROK-1833). Never logs. */
@Injectable()
export class ValheimLinkTokensRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The token row whose hash is `tokenHash`, joined to its server's game. */
  async findByHash(tokenHash: string): Promise<ValheimLinkTokenLookup | null> {
    const [row] = await this.db
      .select({
        tokenId: tokens.id,
        pelicanServerId: tokens.pelicanServerId,
        tokenHash: tokens.tokenHash,
        revokedAt: tokens.revokedAt,
        missingSince: servers.missingSince,
        gameSlug: games.slug,
      })
      .from(tokens)
      .innerJoin(servers, eq(servers.id, tokens.pelicanServerId))
      .leftJoin(games, eq(games.id, servers.gameId))
      .where(eq(tokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  /** Stamp `last_used_at` when null or older than 60 s (one UPDATE). */
  async touchLastUsed(tokenId: number): Promise<void> {
    await this.db
      .update(tokens)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(tokens.id, tokenId),
          or(
            isNull(tokens.lastUsedAt),
            lt(tokens.lastUsedAt, sql`now() - interval '60 seconds'`),
          ),
        ),
      );
  }

  /** The Pelican server with its mapped game slug, or null when unknown. */
  async findServer(id: number): Promise<ValheimLinkServerRef | null> {
    const [row] = await this.db
      .select({ id: servers.id, gameSlug: games.slug })
      .from(servers)
      .leftJoin(games, eq(games.id, servers.gameId))
      .where(eq(servers.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Token status for one server (all-null columns when it has none). */
  async getStatus(id: number): Promise<ValheimLinkTokenStatusRow> {
    const [row] = await this.db
      .select(statusColumns)
      .from(tokens)
      .where(eq(tokens.pelicanServerId, id))
      .limit(1);
    return { pelicanServerId: id, ...(row ?? emptyStatus()) };
  }

  /** Every Valheim-mapped Pelican server LEFT JOIN its token. */
  listValheimStatuses(): Promise<ValheimLinkTokenStatusRow[]> {
    return this.db
      .select({ pelicanServerId: servers.id, ...statusColumns })
      .from(servers)
      .innerJoin(games, eq(games.id, servers.gameId))
      .leftJoin(tokens, eq(tokens.pelicanServerId, servers.id))
      .where(eq(games.slug, VALHEIM_GAME_SLUG))
      .orderBy(asc(servers.name), asc(servers.id));
  }

  /**
   * Issue or rotate in ONE statement: the old hash is overwritten, so the
   * old token dies at once; a revoked row comes back live.
   */
  async upsertToken(
    id: number,
    tokenHash: string,
    tokenHint: string,
    createdBy: number | null,
  ): Promise<void> {
    await this.db
      .insert(tokens)
      .values({ pelicanServerId: id, tokenHash, tokenHint, createdBy })
      .onConflictDoUpdate({
        target: tokens.pelicanServerId,
        set: {
          tokenHash,
          tokenHint,
          createdBy,
          rotatedAt: sql`now()`,
          revokedAt: null,
          lastUsedAt: null,
        },
      });
  }

  /**
   * Non-rotate issue in ONE statement: insert, or revive a revoked row; a
   * live row is left alone (`ON CONFLICT … DO UPDATE … WHERE revoked_at IS
   * NOT NULL`). False when a token is already active (concurrent Generate).
   */
  async issueIfNoneActive(
    id: number,
    tokenHash: string,
    tokenHint: string,
    createdBy: number | null,
  ): Promise<boolean> {
    const rows = await this.db
      .insert(tokens)
      .values({ pelicanServerId: id, tokenHash, tokenHint, createdBy })
      .onConflictDoUpdate({
        target: tokens.pelicanServerId,
        set: {
          tokenHash,
          tokenHint,
          createdBy,
          rotatedAt: sql`now()`,
          revokedAt: null,
          lastUsedAt: null,
        },
        setWhere: sql`${tokens.revokedAt} IS NOT NULL`,
      })
      .returning({ id: tokens.id });
    return rows.length > 0;
  }

  /** Revoke the server's live token. True when one was live. */
  async revoke(id: number): Promise<boolean> {
    const rows = await this.db
      .update(tokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(tokens.pelicanServerId, id), isNull(tokens.revokedAt)))
      .returning({ id: tokens.id });
    return rows.length > 0;
  }

  /** Revoke the live token when the server is no longer mapped to Valheim. */
  async revokeIfNotValheim(id: number): Promise<boolean> {
    const server = await this.findServer(id);
    if (server && server.gameSlug === VALHEIM_GAME_SLUG) return false;
    return this.revoke(id);
  }
}

function emptyStatus(): Omit<ValheimLinkTokenStatusRow, 'pelicanServerId'> {
  return {
    tokenHint: null,
    createdAt: null,
    rotatedAt: null,
    revokedAt: null,
    lastUsedAt: null,
  };
}

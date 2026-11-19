/**
 * ROK-2263: backup-export token rows for the management service and the
 * scoped auth guard. Only the sha256 hash and the 4-char hint are stored —
 * never the plaintext token, and nothing here logs any of the three. Each
 * write is ONE statement; nothing catches and retries.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
/** The transaction handle `insertUnderCap` hands its `afterInsert` hook. */
export type BackupExportTokenTx = Parameters<
  Parameters<Db['transaction']>[0]
>[0];
const tokens = schema.backupExportTokens;
const users = schema.users;

/** `last_used_at` moves at most once per this many seconds (D5). */
export const BACKUP_EXPORT_TOUCH_INTERVAL_SEC = 60;

/** A stored token row (hash included — never send it to a client). */
export type BackupExportTokenRow = typeof tokens.$inferSelect;

/** What `insert` writes; the caller hashes and hints the token first. */
export interface NewBackupExportToken {
  label: string;
  tokenHash: string;
  tokenHint: string;
  createdBy: number;
  expiresAt: Date | null;
}

/** A row as the admin list shows it, with the minting user's name. */
export interface BackupExportTokenDisplayRow {
  id: number;
  label: string;
  tokenHint: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdBy: { id: number; username: string } | null;
}

/** What the guard needs to accept or refuse a bearer (D4). */
export interface BackupExportTokenAuthRow {
  tokenId: number;
  ownerUserId: number;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  role: 'member' | 'operator' | 'admin';
  deactivatedAt: Date | null;
  bannedAt: Date | null;
  kickedAt: Date | null;
}

/** Advisory-lock key serialising mints (arbitrary, unique in this repo). */
const MINT_LOCK_KEY = 2_263_000_001;

/** `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. */
function isLive() {
  return and(
    isNull(tokens.revokedAt),
    or(isNull(tokens.expiresAt), gt(tokens.expiresAt, sql`now()`)),
  );
}

@Injectable()
export class BackupExportTokensRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Store a freshly minted token (hash + hint only). */
  async insert(values: NewBackupExportToken): Promise<BackupExportTokenRow> {
    const [row] = await this.db.insert(tokens).values(values).returning();
    if (!row) throw new Error('backup-export token insert returned no row');
    return row;
  }

  /**
   * Insert unless `cap` live tokens already exist (Q2). The count and the
   * insert share one transaction holding a transaction-scoped advisory lock,
   * so two concurrent mints cannot both pass the cap. Null = cap reached.
   * `afterInsert` runs on the same `tx` (the mint's audit row), so a failure
   * there rolls the token back — no live, unseen token counts toward the cap.
   */
  async insertUnderCap(
    values: NewBackupExportToken,
    cap: number,
    afterInsert?: (
      tx: BackupExportTokenTx,
      row: BackupExportTokenRow,
    ) => Promise<void>,
  ): Promise<BackupExportTokenRow | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${MINT_LOCK_KEY})`);
      const [live] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tokens)
        .where(isLive());
      if ((live?.n ?? 0) >= cap) return null;
      const [row] = await tx.insert(tokens).values(values).returning();
      if (!row) throw new Error('backup-export token insert returned no row');
      if (afterInsert) await afterInsert(tx, row);
      return row;
    });
  }

  /** Every token, newest first, joined to the minting user's name. */
  async listForDisplay(): Promise<BackupExportTokenDisplayRow[]> {
    const rows = await this.db
      .select({
        id: tokens.id,
        label: tokens.label,
        tokenHint: tokens.tokenHint,
        createdAt: tokens.createdAt,
        expiresAt: tokens.expiresAt,
        lastUsedAt: tokens.lastUsedAt,
        revokedAt: tokens.revokedAt,
        creatorId: users.id,
        creatorName: users.username,
      })
      .from(tokens)
      .leftJoin(users, eq(users.id, tokens.createdBy))
      .orderBy(desc(tokens.createdAt), desc(tokens.id));
    return rows.map(({ creatorId, creatorName, ...rest }) => ({
      ...rest,
      createdBy:
        creatorId !== null && creatorName !== null
          ? { id: creatorId, username: creatorName }
          : null,
    }));
  }

  /** One row by id (any state); null when absent. */
  async findById(id: number): Promise<BackupExportTokenRow | null> {
    const [row] = await this.db
      .select()
      .from(tokens)
      .where(eq(tokens.id, id))
      .limit(1);
    return row ?? null;
  }

  /** The token for a hash, joined to its owner's role and lockout columns. */
  async findAuthByHash(
    tokenHash: string,
  ): Promise<BackupExportTokenAuthRow | null> {
    const [row] = await this.db
      .select({
        tokenId: tokens.id,
        ownerUserId: tokens.createdBy,
        tokenHash: tokens.tokenHash,
        revokedAt: tokens.revokedAt,
        expiresAt: tokens.expiresAt,
        role: users.role,
        deactivatedAt: users.deactivatedAt,
        bannedAt: users.bannedAt,
        kickedAt: users.kickedAt,
      })
      .from(tokens)
      .innerJoin(users, eq(users.id, tokens.createdBy))
      .where(eq(tokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  /** Soft-revoke a not-yet-revoked token; null when absent or already revoked. */
  async revoke(id: number): Promise<BackupExportTokenRow | null> {
    const [row] = await this.db
      .update(tokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(tokens.id, id), isNull(tokens.revokedAt)))
      .returning();
    return row ?? null;
  }

  /** Live tokens: not revoked and not past `expires_at` (cap check, Q2). */
  async countLive(): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tokens)
      .where(isLive());
    return row?.n ?? 0;
  }

  /** Stamp last-used (coarse network only), at most once per 60 s. */
  async touchLastUsed(id: number, network: string | null): Promise<void> {
    const interval = BACKUP_EXPORT_TOUCH_INTERVAL_SEC;
    const stale = sql`now() - make_interval(secs => ${interval})`;
    await this.db
      .update(tokens)
      .set({ lastUsedAt: sql`now()`, lastUsedIpCoarse: network })
      .where(
        and(
          eq(tokens.id, id),
          or(isNull(tokens.lastUsedAt), sql`${tokens.lastUsedAt} < ${stale}`),
        ),
      );
  }
}

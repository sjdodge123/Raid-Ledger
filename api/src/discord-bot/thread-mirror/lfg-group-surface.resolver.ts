/**
 * ROK-1483 — the one v1 surface resolver: `lfg-group` (D2).
 *
 * Reads the binding straight off `lfg_group_messages`, the row
 * `LfmEmbedService.postForum` already writes. Nothing here is stored twice, so
 * nothing here can drift out of step with the board.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { ThreadSurfaceRef } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { ThreadMirrorDb } from './thread-mirror.db-helpers';
import type {
  ResolvedThread,
  SurfaceResolver,
} from './thread-surface.registry';

/** The surface kind this resolver owns. */
const KIND = 'lfg-group' as const;

/** Resolves LFG group threads in both directions. */
@Injectable()
export class LfgGroupSurfaceResolver implements SurfaceResolver {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ThreadMirrorDb,
  ) {}

  /**
   * The forum thread of a game's LFG group.
   *
   * Deliberately NOT filtered to `state = 'open'`: an archived thread is the
   * NORMAL terminal state of every LFG group, and the conversation stays
   * readable after the group closes (D12). The newest forum row wins when a
   * game has been posted more than once.
   *
   * @param surfaceId - The game id, as a string.
   * @returns The thread and its guild, or null when the game has no post.
   */
  async resolveThread(surfaceId: string): Promise<ResolvedThread | null> {
    const gameId = Number(surfaceId);
    if (!Number.isInteger(gameId)) return null;
    const [row] = await this.db
      .select({
        threadId: schema.lfgGroupMessages.threadId,
        guildId: schema.lfgGroupMessages.guildId,
      })
      .from(schema.lfgGroupMessages)
      .where(
        and(
          eq(schema.lfgGroupMessages.gameId, gameId),
          eq(schema.lfgGroupMessages.postKind, 'forum'),
          isNotNull(schema.lfgGroupMessages.threadId),
        ),
      )
      .orderBy(desc(schema.lfgGroupMessages.postedAt))
      .limit(1);
    if (!row?.threadId) return null;
    return { threadId: row.threadId, guildId: row.guildId };
  }

  /**
   * The LFG group a thread belongs to.
   *
   * @param threadId - The Discord thread id.
   * @returns `{ kind: 'lfg-group', id: '<gameId>' }`, or null when unowned.
   */
  async resolveSurface(threadId: string): Promise<ThreadSurfaceRef | null> {
    const [row] = await this.db
      .select({ gameId: schema.lfgGroupMessages.gameId })
      .from(schema.lfgGroupMessages)
      .where(
        and(
          eq(schema.lfgGroupMessages.threadId, threadId),
          eq(schema.lfgGroupMessages.postKind, 'forum'),
        ),
      )
      .limit(1);
    return row ? { kind: KIND, id: String(row.gameId) } : null;
  }

  /**
   * The forum threads worth re-walking when the bot reconnects (D14).
   *
   * Scoped to `state = 'open'` — deliberately NARROWER than
   * {@link resolveThread}, which stays broad so a closed group's history keeps
   * rendering (D12). Reconcile is about catching messages the gateway missed
   * while the process was down, and nobody is still posting in a group that
   * has already converted or expired.
   *
   * @returns One entry per live forum post.
   */
  async listActiveThreads(): Promise<ResolvedThread[]> {
    const rows = await this.db
      .select({
        threadId: schema.lfgGroupMessages.threadId,
        guildId: schema.lfgGroupMessages.guildId,
      })
      .from(schema.lfgGroupMessages)
      .where(
        and(
          eq(schema.lfgGroupMessages.state, 'open'),
          eq(schema.lfgGroupMessages.postKind, 'forum'),
          isNotNull(schema.lfgGroupMessages.threadId),
        ),
      );
    return rows.filter(
      (row): row is ResolvedThread => typeof row.threadId === 'string',
    );
  }

  /**
   * Any authenticated caller may read an LFG conversation (D3 / A2).
   *
   * This matches `GET /lfg/:gameId`, which already 200s a group's roster for
   * anyone signed in: a stricter rule here would hide a conversation from
   * people who can already see the roster it is about. The deactivation check
   * lives on the controller's `NotDeactivatedGuard`, not here.
   *
   * @returns Always true.
   */
  canView(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

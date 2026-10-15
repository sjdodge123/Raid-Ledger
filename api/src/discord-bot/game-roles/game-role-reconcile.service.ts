/**
 * ROK-1767: keeps each linked game's Discord role in step with who played.
 *
 * Daily at 07:30 UTC (30 min after the guild reconciliation, so deactivations
 * have landed) every enabled link is diffed and applied. Only roles the bot
 * itself granted are ever removed; Discord mutations run one at a time under
 * a shared per-run cap. `grantNow` is the near-real-time add fired when a
 * presence session opens for a linked game.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import type { Guild } from 'discord.js';
import type { GameRoleRunResultDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { findDesiredMembers } from './game-role-desired.helpers';
import {
  diffGameRole,
  type GameRoleChange,
  type GameRoleDiff,
} from './game-role-diff.helpers';
import {
  addMemberRole,
  fetchGuildMembers,
  fetchRoleState,
  type GuildMembers,
  memberHoldsRole,
  removeMemberRole,
  type RoleState,
} from './game-role-discord.helpers';
import {
  deleteGrant,
  loadEnabledGameRoles,
  loadGrantCandidate,
  loadGrants,
  loadRemovalHints,
  stampReconciled,
  upsertGrant,
  writeAudit,
  type GameRoleDb,
  type GameRoleRow,
} from './game-role-reconcile.helpers';

export const GAME_ROLE_RECONCILE_JOB = 'GameRoleReconcileService_reconcile';

/** Discord role mutations allowed per run, across all games (spec D5). */
export const GAME_ROLE_MUTATION_CAP = 200;

interface RunState {
  budget: number;
  /** ONE full member fetch (gateway op 8) per run, shared by every game. */
  members?: Promise<GuildMembers | undefined>;
  result: GameRoleRunResultDto;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

@Injectable()
export class GameRoleReconcileService {
  private readonly logger = new Logger(GameRoleReconcileService.name);
  /** Per-run Discord mutation budget; a field so tests can shrink it. */
  mutationCap = GAME_ROLE_MUTATION_CAP;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: GameRoleDb,
    private readonly cronJobService: CronJobService,
    private readonly botClient: DiscordBotClientService,
  ) {}

  @Cron('0 30 7 * * *', { name: GAME_ROLE_RECONCILE_JOB })
  async reconcileCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      GAME_ROLE_RECONCILE_JOB,
      async () =>
        (await this.runReconciliation()) === false ? false : undefined,
    );
  }

  /** One pass. `false` when the bot is disconnected (a tracked no-op). */
  async runReconciliation(
    opts: { gameId?: number } = {},
  ): Promise<GameRoleRunResultDto | false> {
    const guild = this.botClient.getGuild();
    if (!guild) {
      this.logger.warn('[ROK-1767] Game-role reconcile skipped — bot offline');
      return false;
    }
    const rows = await loadEnabledGameRoles(this.db, opts.gameId);
    const state: RunState = {
      budget: this.mutationCap,
      result: { added: 0, removed: 0, skippedOverCap: 0, failedGames: [] },
    };
    for (const row of rows) await this.reconcileGuarded(guild, row, state);
    if (state.result.skippedOverCap > 0) {
      this.logger.warn(
        `[ROK-1767] Mutation cap ${this.mutationCap} reached; ` +
          `${state.result.skippedOverCap} change(s) left for the next run`,
      );
    }
    return state.result;
  }

  private async reconcileGuarded(
    guild: Guild,
    row: GameRoleRow,
    state: RunState,
  ): Promise<void> {
    try {
      await this.reconcileOne(guild, row, state);
    } catch (err) {
      state.result.failedGames.push(row.gameId);
      Sentry.captureException(err, { tags: { gameId: String(row.gameId) } });
      this.logger.error(
        `[ROK-1767] Game ${row.gameId} reconcile failed: ${err}`,
      );
    }
  }

  private async reconcileOne(
    guild: Guild,
    row: GameRoleRow,
    state: RunState,
  ): Promise<void> {
    const now = new Date();
    state.members ??= fetchGuildMembers(guild);
    const live = await fetchRoleState(guild, row.roleId, await state.members);
    if (!live) throw new Error(`Discord role ${row.roleId} not found`);
    const diff = await this.computeDiff(row, live, now);
    // Removals first: idle-member cleanup is the point, so a heavy-add day
    // that hits the cap defers adds, not removals.
    for (const c of diff.remove) await this.applyRemove(guild, row, c, state);
    for (const c of diff.add) await this.applyAdd(guild, row, c, state);
    for (const d of diff.dropGrant)
      await deleteGrant(this.db, row.id, d.userId);
    await stampReconciled(this.db, row.id, now);
  }

  private async computeDiff(
    row: GameRoleRow,
    live: RoleState,
    now: Date,
  ): Promise<GameRoleDiff> {
    const desired = await findDesiredMembers(
      this.db,
      row.gameId,
      row.windowDays,
      now,
    );
    const grants = await loadGrants(this.db, row.id);
    const stale = [...grants.keys()].filter((id) => !desired.has(id));
    const hints = await loadRemovalHints(this.db, row.gameId, stale);
    return diffGameRole({
      desired,
      holders: live.holders,
      grants,
      guildMemberIds: live.memberIds,
      now,
      windowDays: row.windowDays,
      hints,
    });
  }

  private spend(state: RunState): boolean {
    if (state.budget <= 0) {
      state.result.skippedOverCap += 1;
      return false;
    }
    state.budget -= 1;
    return true;
  }

  private async applyAdd(
    guild: Guild,
    row: GameRoleRow,
    c: GameRoleChange,
    state: RunState,
  ): Promise<void> {
    if (!this.spend(state)) return;
    if (!(await addMemberRole(guild, c.discordUserId, row.roleId, c.reason))) {
      return;
    }
    await upsertGrant(this.db, row.id, c.userId, c.discordUserId);
    await writeAudit(this.db, {
      gameRoleId: row.id,
      action: 'role_added',
      ...c,
    });
    state.result.added += 1;
  }

  private async applyRemove(
    guild: Guild,
    row: GameRoleRow,
    c: GameRoleChange,
    state: RunState,
  ): Promise<void> {
    if (!this.spend(state)) return;
    const ok = await removeMemberRole(
      guild,
      c.discordUserId,
      row.roleId,
      c.reason,
    );
    await deleteGrant(this.db, row.id, c.userId);
    if (!ok) return;
    await writeAudit(this.db, {
      gameRoleId: row.id,
      action: 'role_removed',
      ...c,
    });
    state.result.removed += 1;
  }

  /**
   * Near-real-time add for one member who just started playing `gameId`.
   * Returns whether the role was granted; never throws.
   */
  async grantNow(userId: number, gameId: number): Promise<boolean> {
    try {
      return await this.tryGrantNow(userId, gameId);
    } catch (err) {
      this.logger.warn(
        `[ROK-1767] grantNow(${userId}, ${gameId}) failed: ${err}`,
      );
      return false;
    }
  }

  private async tryGrantNow(userId: number, gameId: number): Promise<boolean> {
    const guild = this.botClient.getGuild();
    if (!guild) return false;
    const [row] = await loadEnabledGameRoles(this.db, gameId);
    if (!row) return false;
    const who = await loadGrantCandidate(this.db, userId, row.id);
    if (!who || who.granted) return false;
    const holds = await memberHoldsRole(guild, who.discordId, row.roleId);
    if (holds !== false) return false;
    const reason = `played ${ymd(new Date())}`;
    if (!(await addMemberRole(guild, who.discordId, row.roleId, reason))) {
      return false;
    }
    await upsertGrant(this.db, row.id, userId, who.discordId);
    const change = { userId, discordUserId: who.discordId, reason };
    await writeAudit(this.db, {
      gameRoleId: row.id,
      action: 'role_added',
      ...change,
    });
    return true;
  }

  /**
   * Fire-and-forget hook for `GameActivityService.flush`: one `grantNow`
   * per distinct (user, linked game) among the opened sessions, in sequence.
   */
  grantForOpens(
    opens: readonly { userId: number; discordActivityName: string }[],
    gameIdByName: ReadonlyMap<string, number | null>,
  ): void {
    const pairs = new Map<string, [number, number]>();
    for (const o of opens) {
      const gameId = gameIdByName.get(o.discordActivityName);
      if (gameId == null) continue;
      pairs.set(`${o.userId}:${gameId}`, [o.userId, gameId]);
    }
    if (pairs.size === 0) return;
    void (async () => {
      for (const [userId, gameId] of pairs.values()) {
        await this.grantNow(userId, gameId);
      }
    })();
  }
}

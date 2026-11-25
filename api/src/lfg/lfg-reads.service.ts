/**
 * The three LFG group-page reads (ROK-1463): overlap, history, suggestions.
 *
 * Split out of `LfgService` (S6) — that file carries the intent LIFECYCLE
 * (insert under an advisory lock, withdraw, convert) and was already at the
 * 300-line limit. These three are derived projections that write nothing, so
 * they read better as their own provider than as three more methods on the
 * write service.
 *
 * Read-only: no INSERT/UPDATE/DELETE reachable from any method here.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  LfgHistoryResponseDto,
  LfgOverlapResponseDto,
  LfgSuggestionsResponseDto,
  LfgGroupListResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { requireGame, requireVisibleGame } from './lfg-query.helpers';
import { readGroupList } from './lfg-group-list.helpers';
import { resolveLfgGrouping } from './lfg-grouping.helpers';
import { resolveGameReadScope } from './lfg-group-scope.helpers';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { buildOverlapResponse } from './lfg-overlap-grid.helpers';
import { listGameHistory } from './lfg-history.helpers';
import { listSuggestions } from './lfg-suggestions.helpers';

@Injectable()
export class LfgReadsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  /**
   * `GET /lfg/:gameId/overlap` — when the live roster is free (§A).
   *
   * The community default timezone is resolved here because the grid stores
   * each member's LOCAL wall clock: a member with no preference of their own
   * is projected in the community's zone, not the server's (C1).
   *
   * @param gameId - Game whose group to project.
   * @param group - ROK-2352 `?group`; the fold reads the whole game.
   */
  async getOverlap(
    gameId: number,
    group?: string,
  ): Promise<LfgOverlapResponseDto> {
    const game = await requireGame(this.db, gameId);
    const scope = resolveGameReadScope(this.pluginRegistry, game.slug, group);
    const defaultTimeZone = (await this.settings.getDefaultTimezone()) ?? 'UTC';
    return buildOverlapResponse(this.db, gameId, defaultTimeZone, scope);
  }

  /**
   * `GET /lfg/:gameId/history` — past sessions for the game (§B).
   *
   * ROK-2352: `?group` is accepted (and grammar-checked) by the route but not
   * applied — events carry no group key, so a group's history is its game's.
   *
   * @param gameId - Game whose history to read.
   */
  async getHistory(gameId: number): Promise<LfgHistoryResponseDto> {
    await requireGame(this.db, gameId);
    return { gameId, entries: await listGameHistory(this.db, gameId) };
  }

  /**
   * `GET /lfg/:gameId/suggestions` — players who might want in (§C).
   *
   * @param userId - Caller, never suggested to themselves.
   * @param gameId - Game the group is for.
   * @param group - ROK-2352 `?group`: members of THIS group are not suggested.
   */
  async getSuggestions(
    userId: number,
    gameId: number,
    group?: string,
  ): Promise<LfgSuggestionsResponseDto> {
    const game = await requireGame(this.db, gameId);
    const scope = resolveGameReadScope(this.pluginRegistry, game.slug, group);
    return {
      gameId,
      suggestions: await listSuggestions(this.db, gameId, userId, scope),
    };
  }

  /**
   * ROK-2352 `GET /lfg/:gameId/groups` — the game's groups, `''` first. A
   * game with no active `lfg-grouping` adapter is one folded group.
   *
   * @param userId - Caller, for `hasOwnIntent`.
   * @param gameId - The (visible) game.
   * @param includeCatalogue - `?include=catalogue` adds empty groups.
   */
  async listGameGroups(
    userId: number,
    gameId: number,
    includeCatalogue: boolean,
  ): Promise<LfgGroupListResponseDto> {
    const game = await requireVisibleGame(this.db, gameId);
    const adapter = resolveLfgGrouping(this.pluginRegistry, game.slug);
    return readGroupList(this.db, game, userId, adapter, includeCatalogue);
  }
}

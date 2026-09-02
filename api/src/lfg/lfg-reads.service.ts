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
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { requireGame } from './lfg-query.helpers';
import { buildOverlapResponse } from './lfg-overlap-grid.helpers';
import { listGameHistory } from './lfg-history.helpers';
import { listSuggestions } from './lfg-suggestions.helpers';

@Injectable()
export class LfgReadsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * `GET /lfg/:gameId/overlap` — when the live roster is free (§A).
   *
   * The community default timezone is resolved here because the grid stores
   * each member's LOCAL wall clock: a member with no preference of their own
   * is projected in the community's zone, not the server's (C1).
   *
   * @param gameId - Game whose group to project.
   */
  async getOverlap(gameId: number): Promise<LfgOverlapResponseDto> {
    await requireGame(this.db, gameId);
    const defaultTimeZone = (await this.settings.getDefaultTimezone()) ?? 'UTC';
    return buildOverlapResponse(this.db, gameId, defaultTimeZone);
  }

  /**
   * `GET /lfg/:gameId/history` — past sessions for the game (§B).
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
   */
  async getSuggestions(
    userId: number,
    gameId: number,
  ): Promise<LfgSuggestionsResponseDto> {
    await requireGame(this.db, gameId);
    return {
      gameId,
      suggestions: await listSuggestions(this.db, gameId, userId),
    };
  }
}

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  MAX_ROSTER_CLAIM_CANDIDATES,
  RosterClaimCandidatesQuerySchema,
  type RosterClaimCandidateDto,
  type RosterClaimGuildDto,
  type RosterClaimListResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { isForeverGame } from '../../wow-forever-identity.helpers';
import { loadCandidates, type CandidateRow } from './roster-claim.queries';

type Db = PostgresJsDatabase<typeof schema>;

const EMPTY: RosterClaimListResponseDto = { guilds: [], truncated: false };

/**
 * ROK-2128 — "Add character → Guild roster" (WoW: Forever only, FLAG 8).
 * Lists the unclaimed roster characters of every claimable guild (FLAG 1).
 * L2 adds the one-click claim to this service.
 */
@Injectable()
export class RosterClaimService {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** `?gameId=` → the grouped candidates; a non-Forever game lists nothing. */
  async listCandidates(query: unknown): Promise<RosterClaimListResponseDto> {
    const parsed = RosterClaimCandidatesQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('gameId must be a positive integer');
    }
    const { gameId } = parsed.data;
    if (!(await this.isForever(gameId))) return EMPTY;
    const rows = await loadCandidates(this.db, gameId);
    const truncated = rows.length > MAX_ROSTER_CLAIM_CANDIDATES;
    const kept = rows.slice(0, MAX_ROSTER_CLAIM_CANDIDATES);
    return { guilds: groupByGuild(kept), truncated };
  }

  private async isForever(gameId: number): Promise<boolean> {
    const [game] = await this.db
      .select({ slug: schema.games.slug })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    return isForeverGame(game);
  }
}

/** Group sorted candidate rows into guild sections, keeping the row order. */
export function groupByGuild(rows: CandidateRow[]): RosterClaimGuildDto[] {
  const byGuild = new Map<number, RosterClaimGuildDto>();
  for (const row of rows) {
    let guild = byGuild.get(row.guildId);
    if (guild === undefined) {
      guild = {
        guildId: row.guildId,
        guildName: row.guildName,
        region: row.region,
        candidates: [],
      };
      byGuild.set(row.guildId, guild);
    }
    guild.candidates.push(toCandidate(row));
  }
  return [...byGuild.values()];
}

function toCandidate(row: CandidateRow): RosterClaimCandidateDto {
  return {
    memberId: row.memberId,
    name: row.name,
    class: row.class,
    level: row.level,
    source: row.source === 'blizzard' ? 'blizzard' : 'addon_import',
  };
}

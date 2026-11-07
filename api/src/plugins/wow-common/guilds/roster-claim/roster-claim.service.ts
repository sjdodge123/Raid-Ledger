import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  MAX_ROSTER_CLAIM_CANDIDATES,
  RefreshCharacterSchema,
  RosterClaimCandidatesQuerySchema,
  RosterClaimRequestSchema,
  type CharacterDto,
  type RosterClaimCandidateDto,
  type RosterClaimGuildDto,
  type RosterClaimListResponseDto,
} from '@raid-ledger/contract';
import { isUniqueViolation } from '../../../../characters/characters-crud.helpers';
import { mapCharacterToDto } from '../../../../characters/characters-mapping.helpers';
import { CharactersService } from '../../../../characters/characters.service';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  isForeverGame,
  rethrowForeverViolation,
} from '../../wow-forever-identity.helpers';
import { loadCandidates, type CandidateRow } from './roster-claim.queries';
import {
  CLAIMED_FIRST,
  claimWithin,
  readMember,
  type ClaimArgs,
  type ClaimMember,
} from './roster-claim.tx';

type CharacterRow = typeof schema.characters.$inferSelect;

/** Backstop index for a GUID pinned by a racing LedgerLink apply. */
const ADDON_GUID_INDEX = 'idx_characters_addon_guid';

type Db = PostgresJsDatabase<typeof schema>;

const EMPTY: RosterClaimListResponseDto = { guilds: [], truncated: false };

/**
 * ROK-2128 — "Add character → Guild roster" (WoW: Forever only, FLAG 8).
 * Lists the unclaimed roster characters of every claimable guild (FLAG 1).
 * `claim` is the one-click claim (D3–D5), then a best-effort Armory refresh.
 */
@Injectable()
export class RosterClaimService {
  private readonly logger = new Logger(RosterClaimService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly characters: CharactersService,
  ) {}

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

  /**
   * Claim roster row `memberId` for `userId`: 400 bad body, 404 row gone /
   * not visible / not Forever, 409 claimed first. The refresh runs AFTER the
   * commit and never fails the claim (D3).
   */
  async claim(
    userId: number,
    memberId: number,
    body: unknown,
  ): Promise<CharacterDto> {
    const parsed = RosterClaimRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('ruleset must be a selectable ruleset');
    }
    const member = await readMember(this.db, memberId);
    if (!(await this.isForever(member.gameId))) {
      throw new NotFoundException('That roster character is gone');
    }
    const args: ClaimArgs = { userId, memberId, ...parsed.data };
    const row = await this.commitClaim(member, args);
    this.logger.log(
      `User ${userId} claimed roster member ${memberId} as ${row.id}`,
    );
    // The claim just wrote its `roster_claimed` audit (admin slot self-filter).
    return { ...(await this.refreshAfterCommit(row)), rosterClaimed: true };
  }

  /** The tx; a unique-index backstop violation maps to 409 OUTSIDE it. */
  private async commitClaim(
    member: ClaimMember,
    args: ClaimArgs,
  ): Promise<CharacterRow> {
    try {
      return await this.db.transaction((tx) => claimWithin(tx, member, args));
    } catch (error) {
      rethrowForeverViolation(error, member.name, member.region);
      if (isUniqueViolation(error, ADDON_GUID_INDEX)) {
        throw new ConflictException(CLAIMED_FIRST);
      }
      throw error;
    }
  }

  /** D3: best-effort Forever Armory refresh; any failure keeps the claim. */
  private async refreshAfterCommit(row: CharacterRow): Promise<CharacterDto> {
    const dto = RefreshCharacterSchema.safeParse({ region: row.region });
    if (!dto.success) return mapCharacterToDto(row);
    try {
      return await this.characters.refreshExternal(
        row.userId,
        row.id,
        dto.data,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Armory refresh after roster claim ${row.id} skipped: ${reason}`,
      );
      return mapCharacterToDto(row);
    }
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

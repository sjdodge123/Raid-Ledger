import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowGuildJoinGateDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import {
  findHubGuild,
  toGuildSummary,
} from '../../../../guilds/guild-core.queries';
import { isForeverGame } from '../../wow-forever-identity.helpers';
import { isClaimableGuild } from '../roster-claim/roster-claim.queries';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * One 404 for every refusal (unknown, hidden, archived, non-Forever), so the
 * route cannot probe which ids are WoW guilds beyond what `/hubs` lists.
 */
const NOT_FOUND = 'Guild not found';

/**
 * ROK-2132 (Ruling 7) — the join gate's read: the Ruling 1 facts of a
 * claimable WoW: Forever guild hub (the roster-claim pick-list rule) plus two
 * viewer flags. No roster, rank, MOTD, event or post data. Membership comes
 * from `GuildAccessService` (the hub kind's rule), never re-derived here.
 */
@Injectable()
export class JoinGateService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  async gate(actor: GuildActor, guildId: number): Promise<WowGuildJoinGateDto> {
    const hub = await findHubGuild(this.db, guildId);
    if (hub === null || hub.gameSlug === null) {
      throw new NotFoundException(NOT_FOUND);
    }
    const { guild: row, gameSlug } = hub;
    if (!isForeverGame({ slug: gameSlug })) {
      throw new NotFoundException(NOT_FOUND);
    }
    if (!(await this.isClaimable(row.gameId, guildId))) {
      throw new NotFoundException(NOT_FOUND);
    }
    const [isMember, hasForeverCharacter] = await Promise.all([
      this.access.isMember(actor.id, guildId),
      this.ownsCharacterOf(actor.id, row.gameId),
    ]);
    const summary = toGuildSummary(row);
    return {
      guild: {
        id: summary.id,
        gameId: summary.gameId,
        name: summary.name,
        region: summary.region,
        realmName: summary.realmName,
        memberCount: summary.memberCount,
        crest: summary.crest ?? null,
      },
      viewer: { isMember, hasForeverCharacter },
    };
  }

  /** The roster-claim rule (active, unhidden, unarchived `wow_guild`). */
  private async isClaimable(gameId: number, guildId: number): Promise<boolean> {
    const [hit] = await this.db
      .select({ id: schema.guilds.id })
      .from(schema.guilds)
      .where(isClaimableGuild(gameId, guildId))
      .limit(1);
    return hit !== undefined;
  }

  /** The viewer owns at least one character of the guild's (Forever) game. */
  private async ownsCharacterOf(
    userId: number,
    gameId: number,
  ): Promise<boolean> {
    const { characters } = schema;
    const [hit] = await this.db
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.userId, userId), eq(characters.gameId, gameId)))
      .limit(1);
    return hit !== undefined;
  }
}

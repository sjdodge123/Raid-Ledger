import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { GuildContributionsDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type * as schema from '../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { computeGivers } from './guild-contributions.givers';
import {
  USERS_WINDOW_DAYS,
  buildRoster,
  computeMasters,
  computeTemplate,
  computeUsers,
  dayIndex,
} from './guild-contributions.helpers';
import {
  findGivers,
  findPeers,
  findRoster,
  findTemplate,
} from './guild-contributions.queries';

const DAY_MS = 86_400_000;

/**
 * ROK-2148 D.3/D.4 — the Guild contributions card: profession masters, the
 * per-player top-givers meter (with the viewer's own rank) and who runs
 * Mailworthy, all filtered to the latest roster. Members + staff only
 * (`canView`), 403 otherwise — same audience as the guild in-game text. A
 * non-`wow_guild` hub has no Mailworthy rows, so it reads as an empty card.
 */
@Injectable()
export class GuildContributionsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  async get(
    actor: GuildActor,
    guildId: number,
    nowMs: number = Date.now(),
  ): Promise<GuildContributionsDto> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    const since = new Date(nowMs - USERS_WINDOW_DAYS * DAY_MS);
    const [template, giverRows, peerRows, rosterRows] = await Promise.all([
      findTemplate(this.db, guildId),
      findGivers(this.db, guildId),
      findPeers(this.db, guildId, since),
      findRoster(this.db, guildId),
    ]);
    const roster = buildRoster(rosterRows);
    return {
      template: computeTemplate(template, roster),
      masters: computeMasters(template, roster),
      givers: computeGivers(giverRows, roster, dayIndex(nowMs), actor.id),
      users: computeUsers(peerRows, roster, nowMs),
    };
  }
}

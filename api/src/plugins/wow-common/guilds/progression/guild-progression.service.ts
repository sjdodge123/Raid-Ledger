import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowGuildProgressionPageDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import type * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { loadInsightsHubRow } from '../roster-insights/roster-insights.hub-row';
import {
  linkedOwners,
  loadGuildRows,
} from '../roster-insights/roster-insights.refs';
import { loadGuildActivity } from './activity.queries';
import { loadGuildProgression } from './progression.queries';

type Db = PostgresJsDatabase<typeof schema>;

const NOT_MEMBER = 'Not a member of this guild';

/**
 * ROK-1789 Part B (B-3) — the trusted raid reporters of a `wow_guild` hub:
 * the owners of the FULL latest-snapshot roster's linked characters (Q1),
 * exactly what the Raid progress widget passes (`roster-insights.service`).
 */
export async function loadRaidReporters(
  db: Db,
  guildId: number,
): Promise<number[]> {
  return linkedOwners(await loadGuildRows(db, guildId));
}

/**
 * ROK-1789 Part B — `GET plugins/wow/guilds/:id/progression`: the
 * Progression tab's instance sections + 30-day activity feed. Members +
 * staff only (B10, `canView`; 403 before 404 as Part A's recruitment).
 * Only `wow_guild` hubs (404 otherwise); the Forever-only tab (Q-B15) is a
 * web predicate. Uncached (Q-B20).
 */
@Injectable()
export class GuildProgressionService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  /** The page for `guildId` as `actor` sees it at `now`. */
  async page(
    actor: GuildActor,
    guildId: number,
    now: Date = new Date(),
  ): Promise<WowGuildProgressionPageDto> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException(NOT_MEMBER);
    }
    const [hub, reporters] = await Promise.all([
      loadInsightsHubRow(this.db, guildId),
      loadRaidReporters(this.db, guildId),
    ]);
    if (!hub || hub.kind !== 'wow_guild') {
      throw new NotFoundException('Guild not found');
    }
    const progression = await loadGuildProgression(this.db, hub, reporters);
    const activity = await loadGuildActivity(
      this.db,
      guildId,
      now,
      progression.instances,
    );
    return { progression, activity };
  }
}

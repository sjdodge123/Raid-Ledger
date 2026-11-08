/**
 * ROK-2133 D3: the roster Armory pass. Fetches the Battle.net Armory profile
 * of due Forever roster members (never creating `characters` rows) and keeps
 * one snapshot per member. `runDue` is the hourly job; `runForGuild` the
 * pass a manual roster "Sync now" fires for one guild.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { BlizzardCharacterSyncAdapter } from '../blizzard-character-sync.adapter';
import { isForeverArmoryImportEnabled } from '../forever-armory-switch';
import { findForeverGameId } from '../forever-auto-link/forever-auto-link.apply';
import { RosterInsightsCache } from '../guilds/roster-insights/roster-insights.cache';
import {
  listDueRosterMembers,
  type DueRosterMember,
} from './roster-armory.queries';
import {
  fetchForeverArmorySnapshot,
  type SnapshotFetchResult,
} from './snapshot.fetch';
import { recordMemberFailure, writeMemberSnapshot } from './snapshot.apply';
import {
  MAX_MEMBERS_PER_RUN,
  isSnapshotVerified,
  stopsRosterArmoryRun,
  type MemberArmoryErrorKind,
} from './snapshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** One pass's outcome counts per Blizzard id fetched (absent key = 0). */
export type RosterArmoryTally = Partial<
  Record<'written' | MemberArmoryErrorKind, number>
>;

/** Due members sharing one Blizzard id — one fetch, written to each. */
type IdGroup = [DueRosterMember, ...DueRosterMember[]];

@Injectable()
export class RosterArmoryService {
  private readonly logger = new Logger(RosterArmoryService.name);
  private running = false;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly adapter: BlizzardCharacterSyncAdapter,
    private readonly insightsCache: RosterInsightsCache,
  ) {}

  /**
   * Hourly job: ≤ {@link MAX_MEMBERS_PER_RUN} due members of every claimable
   * Forever hub. @returns the tally, or null when skipped (overlap / off).
   */
  runDue(): Promise<RosterArmoryTally | null> {
    return this.guarded(undefined);
  }

  /** The same pass scoped to one guild (manual roster "Sync now"). */
  runForGuild(guildId: number): Promise<RosterArmoryTally | null> {
    return this.guarded(guildId);
  }

  private async guarded(
    guildId: number | undefined,
  ): Promise<RosterArmoryTally | null> {
    if (this.running) {
      this.logger.warn(
        'Forever roster Armory pass already in progress, skipping',
      );
      return null;
    }
    this.running = true;
    try {
      return await this.pass(guildId);
    } finally {
      this.running = false;
    }
  }

  /** Kill switch / Blizzard creds / Forever game → due list → fetch loop. */
  private async pass(
    guildId: number | undefined,
  ): Promise<RosterArmoryTally | null> {
    if (!(await isForeverArmoryImportEnabled(this.settings))) return null;
    if (!(await this.settings.isBlizzardConfigured())) return null;
    const gameId = await findForeverGameId(this.db);
    if (gameId === null) return null;
    const now = new Date();
    const due = await listDueRosterMembers(this.db, {
      gameId,
      now,
      limit: MAX_MEMBERS_PER_RUN,
      guildId,
    });
    const groups = groupByBlizzardId(due.slice(0, MAX_MEMBERS_PER_RUN));
    const tally = await this.processAll(groups, gameId, now);
    this.logger.log(`Forever roster Armory pass: ${JSON.stringify(tally)}`);
    return tally;
  }

  /** Sequential; an upstream error ends the run. Touched guilds re-read. */
  private async processAll(
    groups: IdGroup[],
    gameId: number,
    now: Date,
  ): Promise<RosterArmoryTally> {
    const tally: RosterArmoryTally = {};
    const touched = new Set<number>();
    for (const group of groups) {
      const outcome = await this.processGroup(group, gameId, now);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      if (outcome === 'written') group.forEach((m) => touched.add(m.guildId));
      else if (stopsRosterArmoryRun(outcome)) break;
    }
    touched.forEach((id) => this.insightsCache.invalidateGuild(id));
    return tally;
  }

  /** One fetch for the group; write or back off each member. */
  private async processGroup(
    group: IdGroup,
    gameId: number,
    now: Date,
  ): Promise<'written' | MemberArmoryErrorKind> {
    const res = await this.fetchVerified(group[0], gameId, now);
    for (const m of group) {
      if (!res.ok)
        await recordMemberFailure(this.db, m.memberId, res.kind, now);
      else {
        const id = m.blizzardCharacterId;
        await writeMemberSnapshot(this.db, m.memberId, id, res.snapshot, now);
      }
    }
    return res.ok ? 'written' : res.kind;
  }

  /** Fetch; a profile whose id is not the roster's becomes `id_mismatch`. */
  private async fetchVerified(
    head: DueRosterMember,
    gameId: number,
    now: Date,
  ): Promise<SnapshotFetchResult> {
    const res = await fetchForeverArmorySnapshot(this.db, this.adapter, {
      name: head.characterName,
      region: head.region,
      gameId,
      now,
    });
    if (!res.ok) return res;
    const fetchedId = res.snapshot.blizzardCharacterId;
    if (isSnapshotVerified(fetchedId, head.blizzardCharacterId)) return res;
    return { ok: false, kind: 'id_mismatch' };
  }
}

/** Group due members by Blizzard id, keeping first-seen (oldest) order. */
export function groupByBlizzardId(rows: DueRosterMember[]): IdGroup[] {
  const groups = new Map<number, IdGroup>();
  for (const row of rows) {
    const group = groups.get(row.blizzardCharacterId);
    if (group) group.push(row);
    else groups.set(row.blizzardCharacterId, [row]);
  }
  return [...groups.values()];
}

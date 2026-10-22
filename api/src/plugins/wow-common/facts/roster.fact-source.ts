import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { distinctIds, fact, fanOut } from './fact-source.helpers';
import type {
  RosterCharRef,
  RosterKey,
  WowFactCandidates,
  WowFactField,
  WowFactSource,
} from './wow-fact.types';

const { guildMembers: gm } = schema;
const byMember = (r: RosterCharRef): number | null => r.memberId;

interface MemberRow {
  id: number;
  level: number | null;
  class: string | null;
  lastSeenAt: Date | null;
}

/** One `guild_members` row as facts; asOf = the snapshot time. */
function toCandidates(row: MemberRow): WowFactCandidates {
  const asOf = row.lastSeenAt;
  const out: WowFactCandidates = {};
  if (row.level !== null) out.level = fact(row.level, 'roster', asOf);
  if (row.class !== null) out.class = fact(row.class, 'roster', asOf);
  if (asOf !== null) out.lastOnline = fact(asOf, 'roster', asOf);
  return out;
}

/**
 * ROK-1910 — facts from the guild roster (`guild_members`). Covers EVERY
 * roster row, linked to a character or not.
 */
@Injectable()
export class RosterFactSource implements WowFactSource {
  readonly id = 'roster' as const;
  readonly fields: readonly WowFactField[] = ['level', 'class', 'lastOnline'];

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** One query for the whole batch. */
  async load(
    refs: RosterCharRef[],
  ): Promise<Map<RosterKey, WowFactCandidates>> {
    const ids = distinctIds(refs, byMember);
    if (ids.length === 0) return new Map();
    const rows: MemberRow[] = await this.db
      .select({
        id: gm.id,
        level: gm.level,
        class: gm.class,
        lastSeenAt: gm.lastSeenAt,
      })
      .from(gm)
      .where(inArray(gm.id, ids));
    const byId = new Map(rows.map((r) => [r.id, toCandidates(r)]));
    return fanOut(refs, byMember, byId);
  }
}

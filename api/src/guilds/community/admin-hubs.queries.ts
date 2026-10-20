import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { AdminHubEntry } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { DbOrTx } from './community-membership.queries';

/**
 * ROK-1870 L2b — `GET /admin/hubs?status=`, typed by the contract
 * `AdminHubEntry`; `leader` is null when the live Leader is gone or
 * deactivated (OQ-7 `leaderless`).
 */
export type { AdminHubEntry };

const g = schema.guilds;
const m = schema.hubCommunityMembers;
const u = schema.users;

/** Community hubs in one status, most members first. */
export async function listAdminHubs(
  db: DbOrTx,
  status: 'active' | 'archived',
): Promise<AdminHubEntry[]> {
  const leaderJoin = and(
    eq(m.guildId, g.id),
    sql`${m.role} = 'leader' AND ${m.leftAt} IS NULL AND ${m.bannedAt} IS NULL`,
  );
  const rows = await db
    .select({
      hub: g,
      gameName: schema.games.name,
      leaderId: u.id,
      leaderName: u.username,
      leaderOff: u.deactivatedAt,
    })
    .from(g)
    .innerJoin(schema.games, eq(schema.games.id, g.gameId))
    .leftJoin(m, leaderJoin)
    .leftJoin(u, eq(u.id, m.userId))
    .where(and(eq(g.kind, 'game_community'), eq(g.status, status)))
    .orderBy(desc(g.memberCount), asc(g.id));
  return rows.map((r) => toAdminHubEntry(r, status));
}

interface AdminHubRow {
  hub: schema.GuildSelect;
  gameName: string;
  leaderId: number | null;
  leaderName: string | null;
  leaderOff: Date | null;
}

function toAdminHubEntry(
  r: AdminHubRow,
  status: AdminHubEntry['status'],
): AdminHubEntry {
  return {
    id: r.hub.id,
    gameId: r.hub.gameId,
    gameName: r.gameName,
    name: r.hub.name,
    blurb: r.hub.blurb,
    status,
    memberCount: r.hub.memberCount,
    leader:
      r.leaderId !== null && r.leaderName !== null && r.leaderOff === null
        ? { userId: r.leaderId, username: r.leaderName }
        : null,
    createdAt: r.hub.createdAt.toISOString(),
  };
}

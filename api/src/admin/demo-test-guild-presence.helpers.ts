/**
 * ROK-1916 — the optional `withPresence: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: guild-export presence on the
 * five seeded roster rows for the "Last seen" hub widget:
 *   - online at the export: the GM's Aldren and the officer's Brisa;
 *   - away: the unlinked Corvin 1 day, the member's Dainel 9 days and the
 *     unlinked Elowen 34 days before the export.
 *
 * Plain updates on the roster rows, so a re-seed rewrites the same values.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

export interface SeedPresenceMembers {
  gm: number;
  officer: number;
  member: number;
  /** The two unlinked roster rows (ranks 2 and 4). */
  unlinked: readonly [number, number];
}

export interface SeedPresenceRow {
  id: number;
  onlineAtExport: boolean;
  lastOnlineDays: number;
}

export interface SeededGuildPresence {
  /** Online at the export, roster order. */
  online: string[];
  /** Offline, longest away first. */
  away: { name: string; days: number }[];
}

/** The five presence values, keyed by roster-row id. */
export function seedPresenceRows(m: SeedPresenceMembers): SeedPresenceRow[] {
  const online = (id: number): SeedPresenceRow => ({
    id,
    onlineAtExport: true,
    // The wire omits it when online; 0 deliberately exercises D3 (online wins).
    lastOnlineDays: 0,
  });
  const away = (id: number, days: number): SeedPresenceRow => ({
    id,
    onlineAtExport: false,
    lastOnlineDays: days,
  });
  return [
    online(m.gm),
    online(m.officer),
    away(m.unlinked[0], 1),
    away(m.member, 9),
    away(m.unlinked[1], 34),
  ];
}

/** Writes the seeded presence onto the guild's roster rows. */
export async function seedGuildPresence(
  db: Db,
  members: SeedPresenceMembers,
): Promise<SeededGuildPresence> {
  const t = schema.guildMembers;
  for (const row of seedPresenceRows(members)) {
    const { id, ...set } = row;
    await db.update(t).set(set).where(eq(t.id, id));
  }
  return {
    online: ['Aldren', 'Brisa'],
    away: [
      { name: 'Elowen', days: 34 },
      { name: 'Dainel', days: 9 },
      { name: 'Corvin', days: 1 },
    ],
  };
}

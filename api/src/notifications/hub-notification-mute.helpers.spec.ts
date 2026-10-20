/**
 * ROK-1832 — per-group notification mute helpers (unit, drizzle-mock).
 * The DB round-trip (PK idempotency, cascade) is covered by the integration
 * spec; here we pin the query shapes and the DTO mapping.
 */
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  isHubMuted,
  listHubMutes,
  notHubMutedSql,
  setHubMute,
} from './hub-notification-mute.helpers';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';

const dialect = new PgDialect();

let db: MockDb;

beforeEach(() => {
  db = createDrizzleMock();
});

describe('setHubMute (ROK-1832)', () => {
  it('mute inserts the (user, guild) row with onConflictDoNothing', async () => {
    db.onConflictDoNothing.mockResolvedValueOnce(undefined);
    await setHubMute(db as never, 7, 42, true);
    expect(db.insert).toHaveBeenCalledWith(schema.hubNotificationMutes);
    expect(db.values).toHaveBeenCalledWith({ userId: 7, guildId: 42 });
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('a repeat mute is still a single no-op insert (idempotent)', async () => {
    db.onConflictDoNothing.mockResolvedValue(undefined);
    await setHubMute(db as never, 7, 42, true);
    await setHubMute(db as never, 7, 42, true);
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it('unmute deletes by (user, guild) and never inserts', async () => {
    db.where.mockResolvedValueOnce(undefined);
    await setHubMute(db as never, 7, 42, false);
    expect(db.delete).toHaveBeenCalledWith(schema.hubNotificationMutes);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('isHubMuted', () => {
  it('is true when a row exists', async () => {
    db.limit.mockResolvedValueOnce([{ guildId: 42 }]);
    await expect(isHubMuted(db as never, 7, 42)).resolves.toBe(true);
    expect(db.from).toHaveBeenCalledWith(schema.hubNotificationMutes);
    expect(db.limit).toHaveBeenCalledWith(1);
  });

  it('is false when no row exists', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(isHubMuted(db as never, 7, 42)).resolves.toBe(false);
  });
});

describe('listHubMutes', () => {
  it('maps rows to the DTO, keeps a null gameName, orders by name', async () => {
    const at = new Date('2026-10-19T12:00:00.000Z');
    db.orderBy.mockResolvedValueOnce([
      {
        guildId: 3,
        name: 'Alpha',
        kind: 'game_server',
        gameName: null,
        createdAt: at,
      },
      {
        guildId: 1,
        name: 'Bravo',
        kind: 'wow_guild',
        gameName: 'World of Warcraft',
        createdAt: at,
      },
    ]);
    const res = await listHubMutes(db as never, 7);
    expect(res).toEqual({
      data: [
        {
          guildId: 3,
          name: 'Alpha',
          kind: 'game_server',
          gameName: null,
          mutedAt: '2026-10-19T12:00:00.000Z',
        },
        {
          guildId: 1,
          name: 'Bravo',
          kind: 'wow_guild',
          gameName: 'World of Warcraft',
          mutedAt: '2026-10-19T12:00:00.000Z',
        },
      ],
    });
    expect(db.innerJoin).toHaveBeenCalledWith(schema.guilds, expect.anything());
    expect(db.leftJoin).toHaveBeenCalledWith(schema.games, expect.anything());
    expect(db.orderBy).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when nothing is muted', async () => {
    db.orderBy.mockResolvedValueOnce([]);
    await expect(listHubMutes(db as never, 7)).resolves.toEqual({
      data: [],
    });
  });
});

describe('notHubMutedSql', () => {
  it('renders a NOT EXISTS over hub_notification_mutes, guild bound', () => {
    const q = dialect.sqlToQuery(notHubMutedSql(42));
    const flat = q.sql.replace(/\s+/g, ' ');
    expect(flat).toContain('NOT EXISTS');
    expect(flat).toContain('FROM hub_notification_mutes hnm');
    expect(flat).toContain('hnm.user_id = u.id');
    expect(flat).toMatch(/hnm\.guild_id = \$1/);
    expect(q.params).toEqual([42]);
  });

  it('uses the caller-supplied user column', () => {
    const q = dialect.sqlToQuery(notHubMutedSql(9, sql.raw('gi.user_id')));
    expect(q.sql.replace(/\s+/g, ' ')).toContain('hnm.user_id = gi.user_id');
    expect(q.params).toEqual([9]);
  });
});

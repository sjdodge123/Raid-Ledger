/**
 * ROK-1749 — GuildReconciliationService unit tests (sweep scoping).
 *
 * DB-level behaviour (a never-seen guest survives a real sweep) is covered by
 * the integration spec; here we pin the query shape and the call wiring.
 */
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { GuildReconciliationService } from './guild-reconciliation.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

type Row = { id: number; discordId: string; avatar: string | null };

interface Harness {
  db: MockDb;
  deactivateUser: jest.Mock;
  activeWhere: () => SQL | undefined;
  run: () => Promise<void | false>;
}

/** Fake db: SELECTs resolve by projection (candidate rows vs. count). */
function setup(members: string[], active: Row[], neverSeen = 0): Harness {
  const db = createDrizzleMock();
  let mode: 'active' | 'count' | 'update' = 'update';
  let activeWhere: SQL | undefined;
  db.select.mockImplementation((cols: Record<string, unknown>) => {
    mode = 'n' in cols ? 'count' : 'active';
    return db;
  });
  db.update.mockImplementation(() => {
    mode = 'update';
    return db;
  });
  db.where.mockImplementation((cond: SQL) => {
    if (mode === 'active') activeWhere = cond;
    const result =
      mode === 'active' ? active : mode === 'count' ? [{ n: neverSeen }] : [];
    return Object.assign(Promise.resolve(result), { returning: db.returning });
  });
  db.returning.mockResolvedValue([]);
  const deactivateUser = jest.fn().mockResolvedValue(undefined);
  const botClient = {
    listAllGuildMemberAvatars: jest
      .fn()
      .mockResolvedValue(new Map(members.map((id) => [id, null]))),
  };
  const svc = new GuildReconciliationService(
    db as never,
    { executeWithTracking: jest.fn() } as never,
    botClient as never,
    { deactivateUser } as never,
  );
  return {
    db,
    deactivateUser,
    activeWhere: () => activeWhere,
    run: () => svc.runReconciliation(),
  };
}

const seenStampCalls = (db: MockDb) =>
  db.set.mock.calls.filter(
    ([v]: [Record<string, unknown>]) => 'guildMemberSeenAt' in v,
  );

describe('GuildReconciliationService (ROK-1749 sweep scoping)', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => logSpy.mockRestore());

  it('only loads candidates with guild_member_seen_at IS NOT NULL', async () => {
    const h = setup(['111'], []);
    await h.run();
    const cond = h.activeWhere();
    expect(cond).toBeDefined();
    const { sql } = new PgDialect().sqlToQuery(cond as SQL);
    expect(sql).toContain('"guild_member_seen_at" is not null');
  });

  it('deactivates a stamped user absent from the guild with the sweep reason', async () => {
    const h = setup(['111'], [{ id: 5, discordId: '999', avatar: null }]);
    await h.run();
    expect(h.deactivateUser).toHaveBeenCalledTimes(1);
    expect(h.deactivateUser).toHaveBeenCalledWith(5, 'reconciliation-sweep');
  });

  it('logs how many never-seen users were skipped', async () => {
    const h = setup(['111'], [], 3);
    await h.run();
    const lines = logSpy.mock.calls.map(([m]: [unknown]) => String(m));
    expect(lines.some((m) => m.includes('skipped 3 never-seen'))).toBe(true);
  });

  it('stamps guild_member_seen_at for the member list, chunked at 500', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `${1000 + i}`);
    const h = setup(ids, []);
    await h.run();
    const stamps = seenStampCalls(h.db);
    expect(stamps).toHaveLength(2);
    expect(stamps[0]?.[0]).toEqual({ guildMemberSeenAt: expect.any(Date) });
  });

  it('does not stamp or deactivate when the bot is disconnected', async () => {
    const h = setup([], [{ id: 5, discordId: '999', avatar: null }]);
    const svc = new GuildReconciliationService(
      h.db as never,
      {} as never,
      { listAllGuildMemberAvatars: jest.fn().mockResolvedValue(null) } as never,
      { deactivateUser: h.deactivateUser } as never,
    );
    await expect(svc.runReconciliation()).resolves.toBe(false);
    expect(seenStampCalls(h.db)).toHaveLength(0);
    expect(h.deactivateUser).not.toHaveBeenCalled();
  });
});

/**
 * ROK-1537 — fleet first-Discord-login admin, driven through the real OAuth
 * callback entry point (`AuthService.validateDiscordUser`).
 *
 * AC1: DEMO_MODE + the fleet marker + no configured id → the logging-in user
 *      is promoted by ONE conditional UPDATE scoped to their own row.
 * AC2: a configured `FLEET_ADMIN_DISCORD_ID` skips AC1; Discord login never
 *      resets `role` on an existing row.
 * AC3: without DEMO_MODE the callback never writes a role, marker or not.
 */
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { JwtService } from '@nestjs/jwt';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import type { TokenBlocklistService } from './token-blocklist.service';
import * as schema from '../drizzle/schema';
import { clearAuthUserCache } from './auth-user-cache';
import {
  FLEET_ADMIN_ID_ENV,
  FLEET_FIRST_LOGIN_ENV,
  isFirstLoginAdminEnabled,
} from './fleet-first-login-admin.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const DISCORD_ID = '123456789012345678';
const ENV_KEYS = ['DEMO_MODE', FLEET_FIRST_LOGIN_ENV, FLEET_ADMIN_ID_ENV];
const saved: Record<string, string | undefined> = {};

function setEnv(env: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

const FLEET_ENV = { DEMO_MODE: 'true', [FLEET_FIRST_LOGIN_ENV]: 'true' };

/** Mock db whose transaction records the lock + conditional UPDATE. */
function makeDb(returned: { id: number }[]) {
  const calls: string[] = [];
  const whereArgs: SQL[] = [];
  const setArgs: Record<string, unknown>[] = [];
  const returning = jest.fn().mockImplementation(() => {
    calls.push('update');
    return Promise.resolve(returned);
  });
  const where = jest.fn().mockImplementation((w: SQL) => {
    whereArgs.push(w);
    return { returning };
  });
  const set = jest.fn().mockImplementation((s: Record<string, unknown>) => {
    setArgs.push(s);
    return { where };
  });
  const tx = {
    execute: jest.fn().mockImplementation(() => {
      calls.push('lock');
      return Promise.resolve([]);
    }),
    update: jest.fn().mockReturnValue({ set }),
  };
  const transaction = jest.fn((cb: (t: typeof tx) => unknown) => cb(tx));
  return {
    db: { transaction } as unknown as Db,
    transaction,
    calls,
    whereArgs,
    setArgs,
  };
}

function makeService(db: Db, row = { id: 5, role: 'member' as const }) {
  const users = {
    findByDiscordIdIncludingUnlinked: jest.fn().mockResolvedValue(null),
    createOrUpdate: jest.fn().mockResolvedValue({ ...row, username: 'op' }),
    relinkDiscord: jest.fn(),
  };
  return new AuthService(
    users as unknown as UsersService,
    {} as JwtService,
    db,
    { emit: jest.fn() } as unknown as EventEmitter2,
  );
}

function render(where: SQL) {
  return new PgDialect().sqlToQuery(where);
}

beforeAll(() => ENV_KEYS.forEach((k) => (saved[k] = process.env[k])));
afterAll(() => setEnv(saved));
afterEach(() => clearAuthUserCache());

describe('ROK-1537 AC1 — first Discord login in a fleet env becomes admin', () => {
  beforeEach(() => setEnv(FLEET_ENV));

  it('promotes the logging-in user and returns role admin for the JWT', async () => {
    const m = makeDb([{ id: 5 }]);
    const user = await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    expect(user?.role).toBe('admin');
    expect(m.setArgs).toEqual([expect.objectContaining({ role: 'admin' })]);
  });

  it('takes the advisory lock before the single conditional UPDATE', async () => {
    const m = makeDb([{ id: 5 }]);
    await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    expect(m.calls).toEqual(['lock', 'update']);
  });

  it('scopes the UPDATE to the caller row and gates it on no real Discord admin', async () => {
    const m = makeDb([{ id: 5 }]);
    await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    const { sql, params } = render(m.whereArgs[0]);
    expect(sql).toContain('"users"."id" = $1');
    expect(params).toEqual([5]);
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM users AS fleet_admin/);
    expect(sql).toContain('fleet_admin.discord_id IS NOT NULL');
    expect(sql).toContain("fleet_admin.role = 'admin'");
  });

  it('does not count placeholder admins (admin@local `local:`, `unlinked:`)', async () => {
    const m = makeDb([{ id: 5 }]);
    await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    const { sql } = render(m.whereArgs[0]);
    expect(sql).toContain("fleet_admin.discord_id NOT LIKE 'local:%'");
    expect(sql).toContain("fleet_admin.discord_id NOT LIKE 'unlinked:%'");
  });

  it('logs one line naming the promoted discord_id', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    await makeService(makeDb([{ id: 5 }]).db).validateDiscordUser(
      DISCORD_ID,
      'op',
    );
    const lines = log.mock.calls.filter((c) =>
      String(c[0]).includes(DISCORD_ID),
    );
    expect(lines).toHaveLength(1);
    log.mockRestore();
  });

  it('keeps member when a Discord admin already exists (UPDATE matched 0 rows)', async () => {
    const m = makeDb([]);
    const user = await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(user?.role).toBe('member');
  });

  it('never fails login when the promotion itself errors', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const db = { transaction: jest.fn().mockRejectedValue(new Error('boom')) };
    const user = await makeService(db as unknown as Db).validateDiscordUser(
      DISCORD_ID,
      'op',
    );
    expect(user?.role).toBe('member');
    warn.mockRestore();
  });
});

describe('ROK-1537 AC2 — the configured id wins; login preserves role', () => {
  it('skips the first-login path entirely when FLEET_ADMIN_DISCORD_ID is set', async () => {
    setEnv({ ...FLEET_ENV, [FLEET_ADMIN_ID_ENV]: '999888777666555444' });
    const m = makeDb([{ id: 5 }]);
    const user = await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    expect(m.transaction).not.toHaveBeenCalled();
    expect(user?.role).toBe('member');
  });

  it('createOrUpdate on an existing row never writes `role`', async () => {
    const set = jest.fn().mockReturnValue({
      where: () => ({
        returning: () => Promise.resolve([{ id: 5, role: 'admin' }]),
      }),
    });
    const db = {
      query: {
        users: {
          findFirst: jest.fn().mockResolvedValue({ id: 5, role: 'admin' }),
        },
      },
      update: jest.fn().mockReturnValue({ set }),
    };
    const svc = new UsersService(
      db as unknown as Db,
      {} as TokenBlocklistService,
    );
    await svc.createOrUpdate({ discordId: DISCORD_ID, username: 'op' });
    expect(set).toHaveBeenCalledTimes(1);
    expect(Object.keys(set.mock.calls[0][0] as object)).not.toContain('role');
  });
});

describe('ROK-1537 AC3 — production cannot reach the first-login path', () => {
  it('never changes role with DEMO_MODE unset, even with the marker set', async () => {
    setEnv({ [FLEET_FIRST_LOGIN_ENV]: 'true' });
    const m = makeDb([{ id: 5 }]);
    const user = await makeService(m.db).validateDiscordUser(DISCORD_ID, 'op');
    expect(m.transaction).not.toHaveBeenCalled();
    expect(user?.role).toBe('member');
  });

  it.each([
    ['DEMO_MODE alone is not a fleet marker', { DEMO_MODE: 'true' }],
    [
      'marker must be exactly "true"',
      { DEMO_MODE: 'true', [FLEET_FIRST_LOGIN_ENV]: '1' },
    ],
    [
      'DEMO_MODE must be exactly "true"',
      { DEMO_MODE: 'TRUE', [FLEET_FIRST_LOGIN_ENV]: 'true' },
    ],
  ])('%s', (_label, env) => {
    expect(isFirstLoginAdminEnabled(env as NodeJS.ProcessEnv)).toBe(false);
  });

  it('enables only with DEMO_MODE + marker + empty configured id', () => {
    const env = { ...FLEET_ENV, [FLEET_ADMIN_ID_ENV]: '  ' };
    expect(isFirstLoginAdminEnabled(env as NodeJS.ProcessEnv)).toBe(true);
  });
});

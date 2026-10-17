import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AuthService } from '../auth/auth.service';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';
import {
  DemoTestFixtureUserController,
  fixtureIdentity,
  parseFixtureSlot,
} from './demo-test-fixture-user.controller';

describe('seed-fixture-user slots (ROK-1454)', () => {
  it('slot 1 is the original stable identity every older smoke relies on', () => {
    expect(fixtureIdentity(1)).toEqual({
      discordId: 'smoke-invitee-fixture-001',
      username: 'smoke-invitee-fixture',
    });
  });

  it('higher slots are DISTINCT rows — a third hand must not be the second one', () => {
    const second = fixtureIdentity(2);
    expect(second).toEqual({
      discordId: 'smoke-invitee-fixture-002',
      username: 'smoke-invitee-fixture-2',
    });
    expect(second.discordId).not.toBe(fixtureIdentity(1).discordId);
    expect(second.username).not.toBe(fixtureIdentity(1).username);
  });

  it.each([
    ['no body', undefined, 1],
    ['empty body', {}, 1],
    ['slot 2', { slot: 2 }, 2],
    ['slot 9', { slot: 9 }, 9],
    ['slot 0', { slot: 0 }, 1],
    ['slot 10', { slot: 10 }, 1],
    ['a float', { slot: 2.5 }, 1],
    ['a string', { slot: '2' }, 1],
  ])('parses %s as slot %i', (_label, body, expected) => {
    expect(parseFixtureSlot(body)).toBe(expected);
  });
});

describe('seed-fixture-user upsert (concurrent calls must not race)', () => {
  const originalDemoMode = process.env.DEMO_MODE;
  afterEach(() => {
    process.env.DEMO_MODE = originalDemoMode;
  });

  function buildController() {
    const db = createDrizzleMock();
    db.returning.mockResolvedValue([
      { id: 7, username: 'smoke-invitee-fixture', role: 'member' },
    ]);
    const settings = { getDemoMode: jest.fn().mockResolvedValue(true) };
    const auth = { login: jest.fn().mockReturnValue({ access_token: 'jwt' }) };
    const controller = new DemoTestFixtureUserController(
      db as unknown as PostgresJsDatabase<typeof schema>,
      settings as unknown as SettingsService,
      auth as unknown as AuthService,
    );
    return { db, controller };
  }

  it('writes ONE insert ... on conflict (discord_id) do update — no read-then-insert window', async () => {
    process.env.DEMO_MODE = 'true';
    const { db, controller } = buildController();

    const res = await controller.seedFixtureUser({ slot: 1 });

    expect(db.onConflictDoUpdate).toHaveBeenCalledWith({
      target: schema.users.discordId,
      set: { onboardingCompletedAt: expect.any(Date), deactivatedAt: null },
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(res).toEqual({
      userId: 7,
      discordId: 'smoke-invitee-fixture-001',
      jwt: 'jwt',
    });
  });
});

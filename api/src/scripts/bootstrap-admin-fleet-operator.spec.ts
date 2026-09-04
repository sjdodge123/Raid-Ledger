/**
 * A3-B P6 — fleet-only operator promotion in bootstrap-admin.
 *
 * The bug: a fleet env has no way to make the operator an admin. He signs in
 * with Discord OAuth, `users.createOrUpdate` inserts a fresh row that keeps
 * the schema default `role: 'member'`, and every admin surface is unreachable
 * — so he has to fall back to admin@local behind a password mid-test.
 *
 * The fix: env-spin injects `FLEET_ADMIN_DISCORD_ID` into the bootstrap-admin
 * `docker exec`, and bootstrap-admin upserts THAT ONE Discord id as an admin
 * row. When the operator later OAuths in, `UsersService.createOrUpdate` finds
 * the row by discord_id and updates only username/avatar/updatedAt — `role` is
 * preserved — so he lands as admin with no change to `api/src/auth/**`.
 *
 * This is a fleet-testing convenience, NOT a "first login wins" auth rule. The
 * promotion is doubly gated and both gates must hold:
 *   1. `FLEET_ADMIN_DISCORD_ID` is set — only env-spin's `docker exec -e` sets
 *      it; the production allinone entrypoint (`api/scripts/docker-entrypoint.sh`)
 *      runs `node ./dist/scripts/bootstrap-admin.js` with no such variable.
 *   2. `DEMO_MODE === 'true'` — the established production discriminator
 *      (`demo-test-*.controller.ts`). `DEMO_MODE` appears nowhere in
 *      `Dockerfile.allinone`, `docker-compose.yml`, `docker-entrypoint.sh` or
 *      `.env.docker.example`; env-spin sets it explicitly with `-e DEMO_MODE=true`.
 *
 * These tests pin BOTH gates plus the "only the configured id" property.
 *
 * Harness note: same shape as bootstrap-admin-linked-user.spec.ts — the
 * postgres driver and the drizzle factory are mocked so `bootstrapAdmin()`
 * runs in-process and we can assert on the exact rows it writes. Importing
 * the script is side-effect-free: it guards its auto-run behind
 * `require.main === module`.
 */
import * as realSchema from '../drizzle/schema';
import { bootstrapAdmin } from '../../scripts/bootstrap-admin';

jest.mock('bcrypt', () => ({
  hash: () => Promise.resolve('GENERATED_HASH'),
}));

const OPERATOR_DISCORD_ID = '111222333444555666';

interface InsertRecord {
  table: unknown;
  values: Record<string, unknown>;
  conflictSet?: Record<string, unknown>;
}

const dbState: {
  linkedUserRows: Array<{ id: number }>;
  existingCredRows: Array<{ userId: number | null; passwordHash: string }>;
} = { linkedUserRows: [], existingCredRows: [] };

const capturedInserts: InsertRecord[] = [];

function makeSelectChain(table: unknown) {
  const rows =
    table === realSchema.users
      ? dbState.linkedUserRows
      : dbState.existingCredRows;
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

const fakeDb = {
  select: () => ({ from: (table: unknown) => makeSelectChain(table) }),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const record: InsertRecord = { table, values };
      capturedInserts.push(record);
      return {
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
          record.conflictSet = set;
          return Promise.resolve();
        },
        onConflictDoNothing: () => Promise.resolve(),
        returning: () => Promise.resolve([{ id: 999 }]),
      };
    },
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  delete: () => ({ where: () => Promise.resolve(undefined) }),
};

jest.mock('postgres', () => {
  const sql = () => sql;
  sql.end = jest.fn(() => Promise.resolve(undefined));
  return jest.fn(() => sql);
});
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => fakeDb }));

/**
 * Every row this run wrote to `users`, rendered as `<discordId>:<role>` and
 * joined — so a failing assertion prints WHICH identity got WHICH role rather
 * than a bare boolean. `<none>` means the promotion never fired.
 */
function usersWriteSummary(): string {
  const rows = capturedInserts
    .filter((record) => record.table === realSchema.users)
    .map(
      (record) =>
        `${String(record.values.discordId)}:${String(record.values.role)}`,
    );
  return rows.length > 0 ? rows.join(',') : '<none>';
}

function conflictRoleForOperator(): string {
  const record = capturedInserts.find(
    (candidate) =>
      candidate.table === realSchema.users &&
      candidate.values.discordId === OPERATOR_DISCORD_ID,
  );
  if (!record) return '<no-upsert-for-operator-id>';
  if (!record.conflictSet) return '<insert-without-onConflictDoUpdate>';
  return String(record.conflictSet.role);
}

function resetHarness() {
  // linkedUserRows non-empty keeps bootstrap-admin in linked-user mode, so the
  // legacy `local:admin@local` placeholder INSERT never runs and the only
  // `users` write left in play is the fleet promotion under test.
  dbState.linkedUserRows = [{ id: 42 }];
  dbState.existingCredRows = [{ userId: 42, passwordHash: 'SEEDED_HASH' }];
  capturedInserts.length = 0;
  delete process.env.RESET_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.DEMO_MODE;
  delete process.env.FLEET_ADMIN_DISCORD_ID;
  process.env.DATABASE_URL = 'postgres://test/fake';
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
}

describe('A3-B P6 — fleet operator promotion fires only for the configured id', () => {
  beforeEach(resetHarness);
  afterEach(() => jest.restoreAllMocks());

  it('promotes exactly the configured Discord id inside a fleet env', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.FLEET_ADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;

    await bootstrapAdmin();

    expect(usersWriteSummary()).toBe(`${OPERATOR_DISCORD_ID}:admin`);
  });

  it('promotes an EXISTING row (upsert sets role=admin on conflict, not a duplicate insert)', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.FLEET_ADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;

    await bootstrapAdmin();

    // The operator's row already exists by the time he complains about being a
    // member, so the write MUST be an upsert keyed on discord_id whose conflict
    // branch sets role=admin — an INSERT alone would hit the unique index and
    // leave him a member forever.
    expect(conflictRoleForOperator()).toBe('admin');
  });

  it('never touches a Discord id other than the configured one', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.FLEET_ADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;

    await bootstrapAdmin();

    const otherIdWrites = capturedInserts
      .filter(
        (record) =>
          record.table === realSchema.users &&
          record.values.discordId !== OPERATOR_DISCORD_ID,
      )
      .map((record) => String(record.values.discordId));
    expect(otherIdWrites.join(',') || '<none>').toBe('<none>');
  });
});

describe('A3-B P6 — the promotion cannot fire outside a fleet env', () => {
  beforeEach(resetHarness);
  afterEach(() => jest.restoreAllMocks());

  it('DEMO_MODE unset + id configured → no users write at all', async () => {
    // This is the production shape if the variable ever leaked into a prod
    // environment file: bootstrap-admin must refuse rather than mint an admin.
    process.env.FLEET_ADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;

    await bootstrapAdmin();

    expect(usersWriteSummary()).toBe('<none>');
  });

  it("DEMO_MODE='false' + id configured → no users write at all", async () => {
    process.env.DEMO_MODE = 'false';
    process.env.FLEET_ADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;

    await bootstrapAdmin();

    expect(usersWriteSummary()).toBe('<none>');
  });

  it('DEMO_MODE unset + id configured → warns loudly instead of failing silently', async () => {
    const warnSpy = jest.spyOn(console, 'warn');
    process.env.FLEET_ADMIN_DISCORD_ID = OPERATOR_DISCORD_ID;

    await bootstrapAdmin();

    const warned = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    const matched = /DEMO_MODE/.test(warned) && /refus/i.test(warned);
    expect(
      matched ? 'warned-about-demo-mode-refusal' : `no-such-warning: ${warned}`,
    ).toBe('warned-about-demo-mode-refusal');
  });

  it('fleet env but no id configured → no users write at all', async () => {
    process.env.DEMO_MODE = 'true';

    await bootstrapAdmin();

    expect(usersWriteSummary()).toBe('<none>');
  });

  it('fleet env + a non-snowflake id → refuses rather than guessing', async () => {
    // Guards against pointing the promotion at the `local:admin@local`
    // placeholder (or any non-Discord value) via a typo in /srv/rl-infra/.env.
    process.env.DEMO_MODE = 'true';
    process.env.FLEET_ADMIN_DISCORD_ID = 'local:admin@local';

    await bootstrapAdmin();

    expect(usersWriteSummary()).toBe('<none>');
  });
});

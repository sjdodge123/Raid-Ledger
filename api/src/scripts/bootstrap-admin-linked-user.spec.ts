/**
 * ROK-1331 M6a — bootstrap-admin UPDATE-when-linked branch (TDD red).
 *
 * Spec ROK-1331-M6a §"Bootstrap-admin contract addition":
 *   When the env's `users` table already has an admin row whose `discord_id`
 *   is NOT NULL and NOT `local:%`, bootstrap-admin MUST attach the
 *   `local_credentials` row to that user instead of inserting a duplicate
 *   `local:admin@local` placeholder. Three branches:
 *     1. linkedUser present + existingCred.userId === linkedUser.id
 *          → just reset password.
 *     2. linkedUser present + existingCred.userId !== linkedUser.id
 *          → DELETE orphan placeholder, INSERT cred bound to linkedUser.id.
 *     3. linkedUser absent → existing behavior (INSERT placeholder).
 *
 * Today's bootstrap-admin.ts ONLY handles branches 1 and 3. M6a dev MUST
 * add the linked-user resolver + the UPDATE branch. This test should FAIL
 * until that lands.
 *
 * We don't boot a real Postgres for this test (the integration runner is
 * heavy and the script doesn't export its core function). Instead, we
 * inspect the script's TEXT for the contract markers the dev MUST add,
 * mirroring the pre-merge gate the architect requires.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as realSchema from '../drizzle/schema';
// Importing the script is side-effect-free under Jest: bootstrap-admin.ts
// guards its auto-run behind `require.main === module`, which is false here.
import { bootstrapAdmin } from '../../scripts/bootstrap-admin';

// ── ROK-1356 regression harness ──────────────────────────────────────────
// We mock the DB driver + drizzle factory so we can invoke bootstrapAdmin()
// in-process and assert on the exact values written to local_credentials.
// `bcrypt.hash` is stubbed to a deterministic sentinel so a "freshly
// generated" hash is trivially distinguishable from a carried-forward one.
const bcryptHash = jest.fn(
  (...args: [password: string, saltRounds: number]): Promise<string> => {
    void args;
    return Promise.resolve('GENERATED_HASH');
  },
);
jest.mock('bcrypt', () => ({
  hash: (password: string, saltRounds: number) =>
    bcryptHash(password, saltRounds),
}));

// The captured drizzle write builder mutates this between scenarios.
interface DbState {
  linkedUserRows: Array<{ id: number }>;
  existingCredRows: Array<{ userId: number | null; passwordHash: string }>;
}
const dbState: DbState = { linkedUserRows: [], existingCredRows: [] };
const capturedWrites: Array<{
  op: 'insert-values' | 'onConflictDoUpdate-set' | 'update-set';
  values: Record<string, unknown>;
}> = [];

function makeSelectChain(table: unknown) {
  // Routes the two SELECTs by table identity. `.limit()` resolves the rows.
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
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      capturedWrites.push({ op: 'insert-values', values });
      return {
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
          capturedWrites.push({ op: 'onConflictDoUpdate-set', values: set });
          return Promise.resolve();
        },
        onConflictDoNothing: () => Promise.resolve(),
        returning: () => Promise.resolve([{ id: 999 }]),
      };
    },
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      capturedWrites.push({ op: 'update-set', values });
      return { where: () => Promise.resolve(undefined) };
    },
  }),
  delete: () => ({ where: () => Promise.resolve(undefined) }),
};

jest.mock('postgres', () => {
  const sql = () => sql;
  sql.end = jest.fn(() => Promise.resolve(undefined));
  return jest.fn(() => sql);
});
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => fakeDb }));

function resetRok1356Harness() {
  dbState.linkedUserRows = [];
  dbState.existingCredRows = [];
  capturedWrites.length = 0;
  bcryptHash.mockClear();
  delete process.env.RESET_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  process.env.DATABASE_URL = 'postgres://test/fake';
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function rebindWrite() {
  // The value the rebind branch persists (both the insert .values and the
  // onConflictDoUpdate .set carry the same passwordHash).
  return capturedWrites.find((w) => w.op === 'onConflictDoUpdate-set');
}

describe('ROK-1331 M6a — bootstrap-admin linked-user branch', () => {
  const SCRIPT_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    'scripts',
    'bootstrap-admin.ts',
  );
  const scriptText = fs.existsSync(SCRIPT_PATH)
    ? fs.readFileSync(SCRIPT_PATH, 'utf8')
    : '';

  it('script file exists at api/scripts/bootstrap-admin.ts', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('resolves a linkedUser via a SELECT on users.discord_id with admin role', () => {
    // The dev MUST add a select that filters on:
    //   discord_id IS NOT NULL AND discord_id NOT LIKE 'local:%' AND role = 'admin'
    // Defensive grep — accept drizzle syntax (eq/and/not/isNotNull/like)
    // OR raw SQL. The presence of `linkedUser` (or equivalent symbol) +
    // a NOT-LIKE check on `local:%` is the load-bearing signal.
    expect(scriptText).toMatch(/linkedUser|linked_user|linked-user/i);
    expect(scriptText).toMatch(/local:%|notLike|NOT LIKE/i);
  });

  it('detects orphan local-credential mismatch (existingCred.userId !== linkedUser.id)', () => {
    // The branch where existingCred.userId !== linkedUser.id MUST trigger
    // DELETE of the orphan `local:admin@local` user. Look for either a
    // DELETE FROM users discord_id="local:admin@local" or a drizzle
    // .delete(users).where(eq(discordId, 'local:admin@local')) shape.
    const hasOrphanDelete =
      /delete[\s\S]{0,200}local:admin@local/i.test(scriptText) ||
      /\.delete\(\s*\w+\.users\s*\)[\s\S]{0,200}local:admin@local/i.test(
        scriptText,
      );
    expect(hasOrphanDelete).toBe(true);
  });

  it('binds local_credentials.userId to the linkedUser when present', () => {
    // The new INSERT path MUST set userId to linkedUser.id (not the
    // placeholder adminUser.id). Look for an insert that references
    // linkedUser.id explicitly.
    expect(scriptText).toMatch(
      /userId:\s*linkedUser\.id|user_id:\s*linkedUser\.id/,
    );
  });

  it('logs the active branch (linked-user mode vs local-admin mode)', () => {
    // Spec line 68: bootstrap-admin SHOULD log loudly which branch it
    // took. Operators need to spot misroutes during a sync.
    expect(scriptText).toMatch(
      /linked-user mode|local-admin mode|linkedUser mode/,
    );
  });
});

describe('Regression: ROK-1356 — rebind preserves seeded password', () => {
  // The fleet bug: env_spin seeds admin@local with a known password and
  // returns it as `admin_password`; restart_for_settings then re-runs
  // bootstrap-admin in linked-user mode where the existing cred is bound to
  // the `local:admin@local` PLACEHOLDER (not linkedUser.id), so the rebind
  // path runs — and used to re-hash a FRESH random password, invalidating the
  // password the caller already holds. The fix carries the existing hash
  // forward unless RESET_PASSWORD / ADMIN_PASSWORD say otherwise.
  beforeEach(() => {
    resetRok1356Harness();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rebind from placeholder, no reset, no fixed password → carries EXISTING hash forward (userId-only change)', async () => {
    dbState.linkedUserRows = [{ id: 42 }];
    // Existing cred is bound to the placeholder user (id 7), NOT the linked
    // user (id 42) → credAlreadyBound is false → rebind branch runs.
    dbState.existingCredRows = [{ userId: 7, passwordHash: 'SEEDED_HASH' }];

    await bootstrapAdmin();

    const write = rebindWrite();
    expect(write).toBeDefined();
    // userId is re-anchored to the linked user…
    expect(write!.values.userId).toBe(42);
    // …but the password hash is the EXISTING one, not a freshly generated one.
    expect(write!.values.passwordHash).toBe('SEEDED_HASH');
    expect(write!.values.passwordHash).not.toBe('GENERATED_HASH');
    // The insert .values path must carry the same forwarded hash.
    const insertValues = capturedWrites.find((w) => w.op === 'insert-values');
    expect(insertValues!.values.passwordHash).toBe('SEEDED_HASH');
  });

  it('rebind from placeholder + RESET_PASSWORD=true → applies a FRESH hash', async () => {
    process.env.RESET_PASSWORD = 'true';
    dbState.linkedUserRows = [{ id: 42 }];
    dbState.existingCredRows = [{ userId: 7, passwordHash: 'SEEDED_HASH' }];

    await bootstrapAdmin();

    const write = rebindWrite();
    expect(write).toBeDefined();
    expect(write!.values.userId).toBe(42);
    expect(write!.values.passwordHash).toBe('GENERATED_HASH');
  });

  it('rebind from placeholder + ADMIN_PASSWORD set → applies the fixed password hash', async () => {
    process.env.ADMIN_PASSWORD = 'fleet-fixed-pw';
    dbState.linkedUserRows = [{ id: 42 }];
    dbState.existingCredRows = [{ userId: 7, passwordHash: 'SEEDED_HASH' }];

    await bootstrapAdmin();

    const write = rebindWrite();
    expect(write).toBeDefined();
    expect(write!.values.userId).toBe(42);
    // bcrypt.hash was called with the fixed password and produced the hash
    // we persist (the stub returns GENERATED_HASH for any input).
    expect(write!.values.passwordHash).toBe('GENERATED_HASH');
    expect(bcryptHash).toHaveBeenCalledWith(
      'fleet-fixed-pw',
      expect.anything(),
    );
  });
});

describe('Regression: ROK-1356 — banner output on rebind vs first creation', () => {
  beforeEach(() => {
    resetRok1356Harness();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('no existing credential + linked user → generates a password and prints the INITIAL banner', async () => {
    const logSpy = jest.spyOn(console, 'log');
    dbState.linkedUserRows = [{ id: 42 }];
    dbState.existingCredRows = []; // first creation

    await bootstrapAdmin();

    const write = rebindWrite();
    expect(write).toBeDefined();
    expect(write!.values.userId).toBe(42);
    // First creation must use the generated hash, not carry anything forward.
    expect(write!.values.passwordHash).toBe('GENERATED_HASH');
    // The INITIAL ADMIN CREDENTIALS banner fires (vs the rebound/unchanged log).
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('INITIAL ADMIN CREDENTIALS');
  });

  it('carry-forward case does NOT print a banner claiming a new password', async () => {
    const logSpy = jest.spyOn(console, 'log');
    dbState.linkedUserRows = [{ id: 42 }];
    dbState.existingCredRows = [{ userId: 7, passwordHash: 'SEEDED_HASH' }];

    await bootstrapAdmin();

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).not.toContain('INITIAL ADMIN CREDENTIALS');
    expect(printed).not.toContain('ADMIN PASSWORD RESET');
    expect(printed).toMatch(/rebound, password unchanged/i);
  });
});

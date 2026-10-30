/**
 * ROK-1701 — bootstrap-admin and the setup claim.
 *
 * NAS (flavour unset): byte-identical console output to the pre-ROK-1701
 * script. The golden arrays below were captured from the unmodified script
 * (commit 526d832cb) with a fixed ADMIN_PASSWORD, so any new NAS line —
 * including one from the Sentry instrument import — fails here.
 *
 * Harness: same shape as bootstrap-admin-fleet-operator.spec.ts — postgres and
 * the drizzle factory are mocked so `bootstrapAdmin()` runs in-process.
 */
import * as realSchema from '../drizzle/schema';
import { bootstrapAdmin } from '../../scripts/bootstrap-admin';

jest.mock('../sentry/instrument', () => ({}));
jest.mock('bcrypt', () => ({
  hash: () => Promise.resolve('GENERATED_HASH'),
  compare: () => Promise.resolve(true),
}));

const FIXED_PASSWORD = 'Golden-Fixed-Pass-1';

const dbState: {
  existingCredRows: Array<{ userId: number | null; passwordHash: string }>;
} = { existingCredRows: [] };
const credentialWrites: string[] = [];

function makeSelectChain(table: unknown) {
  // No linked admin → legacy local-admin mode (the NAS first-boot shape).
  const rows = table === realSchema.users ? [] : dbState.existingCredRows;
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

const fakeDb: Record<string, unknown> = {
  select: () => ({ from: (table: unknown) => makeSelectChain(table) }),
  insert: (table: unknown) => ({
    values: () => {
      if (table === realSchema.localCredentials) credentialWrites.push('insert');
      return {
        onConflictDoUpdate: () => Promise.resolve(),
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ id: 999 }]),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        }),
      };
    },
  }),
  update: () => ({
    set: () => ({
      where: () => {
        credentialWrites.push('update');
        return Promise.resolve(undefined);
      },
    }),
  }),
  delete: () => ({ where: () => Promise.resolve(undefined) }),
  transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

jest.mock('postgres', () => {
  const sql = () => sql;
  sql.end = jest.fn(() => Promise.resolve(undefined));
  return jest.fn(() => sql);
});
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => fakeDb }));

const RULE = '========================================================';
const THIN = '--------------------------------------------------------';
const PLACEHOLDER_LINE =
  'bootstrap-admin: local-admin mode → using local:admin@local placeholder';

/** Today's banner, verbatim (`printAdminBanner`). */
function goldenBanner(title: string): string[] {
  return [
    '',
    RULE,
    `  ${title}`,
    RULE,
    '  Email:    admin@local',
    `  Password: ${FIXED_PASSWORD}`,
    THIN,
    '  Save this password! It will not be shown again.',
    '  To reset, set RESET_PASSWORD=true and restart.',
    THIN,
    '  NEXT STEPS',
    '  1. Open the app on the port you published (e.g. http://<host>:8080), go to /login → "Sign in with username instead" → admin@local',
    '  2. Admin Settings → Discord OAuth to let your community sign in',
    RULE,
    '',
  ];
}

const GOLDEN_FIRST_CREATION = [
  PLACEHOLDER_LINE,
  ...goldenBanner('INITIAL ADMIN CREDENTIALS'),
];
const GOLDEN_EXISTING = [
  PLACEHOLDER_LINE,
  'bootstrap-admin: local-admin mode → local credentials already exist, skipping bootstrap',
  '  Admin credentials already exist (admin@local) — password unchanged.',
  '  Forgot it? Start ONCE with RESET_PASSWORD=true and ADMIN_PASSWORD=<your choice>, then remove RESET_PASSWORD.',
];
const GOLDEN_RESET = [PLACEHOLDER_LINE, ...goldenBanner('ADMIN PASSWORD RESET')];

/** Every console line of the run, all streams, in order (`<stream>|<text>`). */
const consoleLines: string[] = [];

function capture(stream: 'log' | 'warn' | 'error') {
  return jest
    .spyOn(console, stream)
    .mockImplementation((...args: unknown[]) => {
      consoleLines.push(`${stream}|${args.map(String).join(' ')}`);
    });
}

function logLines(): string[] {
  return consoleLines
    .filter((line) => line.startsWith('log|'))
    .map((line) => line.slice(4));
}

function resetHarness(): void {
  dbState.existingCredRows = [];
  credentialWrites.length = 0;
  consoleLines.length = 0;
  for (const key of [
    'RESET_PASSWORD',
    'RL_FLAVOUR',
    'SETUP_CODE',
    'DEMO_MODE',
    'FLEET_ADMIN_DISCORD_ID',
    'FLEET_FIRST_DISCORD_LOGIN_ADMIN',
  ]) {
    delete process.env[key];
  }
  process.env.ADMIN_PASSWORD = FIXED_PASSWORD;
  process.env.DATABASE_URL = 'postgres://test/fake';
  capture('log');
  capture('warn');
  capture('error');
}

describe('ROK-1701 — NAS bootstrap console output is byte-identical (golden)', () => {
  beforeEach(resetHarness);
  afterEach(() => jest.restoreAllMocks());

  it('first creation prints exactly the pre-ROK-1701 lines', async () => {
    await bootstrapAdmin();

    expect(consoleLines.join('\n')).toBe(
      GOLDEN_FIRST_CREATION.map((l) => `log|${l}`).join('\n'),
    );
    expect(credentialWrites).toEqual(['insert']);
  });

  it('existing credential prints exactly the pre-ROK-1701 hint', async () => {
    dbState.existingCredRows = [{ userId: 999, passwordHash: 'SEEDED_HASH' }];

    await bootstrapAdmin();

    expect(consoleLines.join('\n')).toBe(
      GOLDEN_EXISTING.map((l) => `log|${l}`).join('\n'),
    );
    expect(credentialWrites).toEqual([]);
  });

  it('RESET_PASSWORD=true prints exactly the pre-ROK-1701 reset banner', async () => {
    dbState.existingCredRows = [{ userId: 999, passwordHash: 'SEEDED_HASH' }];
    process.env.RESET_PASSWORD = 'true';

    await bootstrapAdmin();

    expect(logLines()).toEqual(GOLDEN_RESET);
    expect(consoleLines.join('\n')).toBe(
      GOLDEN_RESET.map((l) => `log|${l}`).join('\n'),
    );
    expect(credentialWrites).toEqual(['update']);
  });
});

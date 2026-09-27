/**
 * ROK-1469 D1 — unit tests for the fleet settings overlay applier
 * (`api/scripts/apply-settings-overlay.ts`).
 *
 * The overlay is how a fleet env ends up with ITS SLOT's Discord identity
 * (bot token + OAuth client id/secret) instead of whatever the operator's
 * laptop happened to hold when `sync_settings` ran. It must:
 *   - reuse the app's own encryption path (never hand-written ciphertext),
 *   - refuse unknown setting keys (a typo silently writing a dead row is
 *     worse than a loud failure),
 *   - never echo secret VALUES — only key names — because its stdout is
 *     captured by the orchestrator and lands in agent transcripts.
 *
 * `child_process`-free: the pure helpers are exported so the contract is
 * testable without a database or a container.
 */
jest.mock('../sentry/instrument', () => ({}));
// applyOverlay's own crypto is out of scope here; a marker keeps the fake db
// able to prove WHICH keys were written without a JWT_SECRET in the test env.
jest.mock('../settings/encryption.util', () => ({
  encrypt: (v: string) => `enc:${v}`,
}));
// main() opens its own client; hand it the fake db of the current test.
let mockDb: unknown;
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => mockDb }));
jest.mock('postgres', () => ({
  __esModule: true,
  default: () => ({ end: () => Promise.resolve() }),
}));

import {
  IDENTITY_KEYS,
  SLOT_IDENTITY_ENV_MAP,
  applyOverlay,
  buildOverlayFromEnv,
  main,
  parseOverlayArgs,
  parseOverlayPayload,
  summarizeOverlay,
} from '../../scripts/apply-settings-overlay';

describe('apply-settings-overlay: parseOverlayPayload (ROK-1469)', () => {
  it('parses a flat JSON map of known setting keys', () => {
    const raw = JSON.stringify({
      discord_bot_token: 'tok',
      discord_client_id: '123',
    });
    expect(parseOverlayPayload(raw)).toEqual({
      discord_bot_token: 'tok',
      discord_client_id: '123',
    });
  });

  it('returns an empty map for blank input (no overlay configured)', () => {
    expect(parseOverlayPayload('')).toEqual({});
    expect(parseOverlayPayload('   \n')).toEqual({});
  });

  it('rejects a key that is not a known app setting', () => {
    const raw = JSON.stringify({ discrod_bot_token: 'typo' });
    expect(() => parseOverlayPayload(raw)).toThrow(/unknown setting key/i);
  });

  it('rejects non-string values instead of coercing them', () => {
    const raw = JSON.stringify({ discord_bot_enabled: true });
    expect(() => parseOverlayPayload(raw)).toThrow(/must be a string/i);
  });

  it('rejects a JSON array / scalar payload', () => {
    expect(() => parseOverlayPayload('["discord_bot_token"]')).toThrow(
      /object/i,
    );
  });

  it('reports malformed JSON without echoing the payload (review M5)', () => {
    // The message travels into env-spin's overlay_warnings AND Sentry. V8's
    // parser text quotes the offending input ("Unexpected token t in JSON at
    // position 21"), which for a truncated payload is a slice of a bot token.
    const secretish = '{"discord_bot_token":"MTIzNDU2Nzg5.GhIjKl.SECRETVALUE"';
    expect(() => parseOverlayPayload(secretish)).toThrow(
      /overlay payload is not valid JSON/i,
    );
    try {
      parseOverlayPayload(secretish);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('SECRETVALUE');
      expect(message).not.toMatch(/position \d+/);
    }
  });

  it('never includes the offending VALUE in the error message', () => {
    const raw = JSON.stringify({ nope_key: 'super-secret-token-value' });
    expect(() => parseOverlayPayload(raw)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('super-secret-token-value'),
      }) as Error,
    );
  });
});

describe('apply-settings-overlay: buildOverlayFromEnv (ROK-1469)', () => {
  it('maps the slot identity env vars onto their app_settings keys', () => {
    const overlay = buildOverlayFromEnv({
      RL_SLOT_DISCORD_BOT_TOKEN: 'bot-token',
      RL_SLOT_DISCORD_CLIENT_ID: 'client-id',
      RL_SLOT_DISCORD_CLIENT_SECRET: 'client-secret',
    });
    expect(overlay).toMatchObject({
      discord_bot_token: 'bot-token',
      discord_client_id: 'client-id',
      discord_client_secret: 'client-secret',
    });
  });

  it('enables the bot whenever a slot token is injected', () => {
    const overlay = buildOverlayFromEnv({
      RL_SLOT_DISCORD_BOT_TOKEN: 'bot-token',
    });
    expect(overlay.discord_bot_enabled).toBe('true');
  });

  it('does not enable the bot when only the OAuth pair is present', () => {
    const overlay = buildOverlayFromEnv({
      RL_SLOT_DISCORD_CLIENT_ID: 'client-id',
    });
    expect(overlay.discord_bot_enabled).toBeUndefined();
  });

  it('ignores blank/whitespace env values rather than writing empty rows', () => {
    expect(
      buildOverlayFromEnv({
        RL_SLOT_DISCORD_BOT_TOKEN: '',
        RL_SLOT_DISCORD_CLIENT_ID: '   ',
      }),
    ).toEqual({});
  });

  it('maps every env var in SLOT_IDENTITY_ENV_MAP to a known setting key', () => {
    const envVars = Object.keys(SLOT_IDENTITY_ENV_MAP);
    expect(envVars).toContain('RL_SLOT_DISCORD_BOT_TOKEN');
    const filled: Record<string, string> = {};
    for (const v of envVars) filled[v] = 'x';
    const overlay = buildOverlayFromEnv(filled);
    for (const key of Object.values(SLOT_IDENTITY_ENV_MAP)) {
      expect(overlay[key]).toBe('x');
    }
  });
});

describe('apply-settings-overlay: summarizeOverlay (ROK-1469)', () => {
  it('reports key NAMES only — never the secret values', () => {
    const summary = summarizeOverlay({
      discord_bot_token: 'super-secret-token-value',
      discord_client_id: '1234567890',
    });
    const serialized = JSON.stringify(summary);
    expect(summary.applied).toEqual(['discord_bot_token', 'discord_client_id']);
    expect(summary.count).toBe(2);
    expect(serialized).not.toContain('super-secret-token-value');
    expect(serialized).not.toContain('1234567890');
  });
});

/**
 * A drizzle stand-in over an in-memory app_settings table. `existing` models
 * what the laptop sync_settings already copied. Supports the two write shapes
 * the overlay uses: UPSERT, and INSERT … ON CONFLICT DO NOTHING RETURNING.
 */
function fakeDb(existing: Record<string, string> = {}): {
  db: never;
  rows: Map<string, string>;
} {
  const rows = new Map(Object.entries(existing));
  const db = {
    insert: () => ({
      values: (row: { key: string; encryptedValue: string }) => ({
        onConflictDoUpdate: () => {
          rows.set(row.key, row.encryptedValue);
          return Promise.resolve();
        },
        onConflictDoNothing: () => ({
          returning: () => {
            if (rows.has(row.key)) return Promise.resolve([]);
            rows.set(row.key, row.encryptedValue);
            return Promise.resolve([{ key: row.key }]);
          },
        }),
      }),
    }),
  };
  return { db: db as never, rows };
}

// Operator ruling 2026-09-27: "When the laptop sync succeeds, the overlay
// applies only the slot-identity keys and skips the keys the sync just
// copied. The bundle still fills everything when the sync fails or is
// skipped."
const FULL_OVERLAY = {
  itad_api_key: 'bundle-itad',
  blizzard_client_secret: 'bundle-bliz',
  discord_bot_token: 'slot-tok',
  discord_client_id: '200',
  discord_client_secret: 'slot-sec',
  discord_bot_enabled: 'true',
  demo_mode: 'true',
};
const IDENTITY = [
  'discord_bot_token',
  'discord_client_id',
  'discord_client_secret',
  'discord_bot_enabled',
  'demo_mode',
];
/** What a successful laptop sync left: the operator's bot + a fresh ITAD key. */
const SYNCED = {
  discord_bot_token: 'enc:operator-tok',
  itad_api_key: 'enc:synced-itad',
};

describe('apply-settings-overlay: applyOverlay with syncWins (sync succeeded)', () => {
  it('always UPSERTs the identity keys, over the synced operator bot', async () => {
    const { db, rows } = fakeDb(SYNCED);
    const res = await applyOverlay(db, FULL_OVERLAY, { syncWins: true });
    expect(rows.get('discord_bot_token')).toBe('enc:slot-tok');
    expect(rows.get('demo_mode')).toBe('enc:true');
    expect([...res.applied].sort()).toEqual([...IDENTITY].sort());
  });

  it('keeps a shared key the sync already wrote (the sync wins)', async () => {
    const { db, rows } = fakeDb(SYNCED);
    const res = await applyOverlay(db, FULL_OVERLAY, { syncWins: true });
    expect(rows.get('itad_api_key')).toBe('enc:synced-itad');
    expect(res.kept_synced).toEqual(['itad_api_key']);
  });

  it('inserts a shared key the laptop DB lacked (the bundle still fills it)', async () => {
    const { db, rows } = fakeDb(SYNCED);
    const res = await applyOverlay(db, FULL_OVERLAY, { syncWins: true });
    expect(rows.get('blizzard_client_secret')).toBe('enc:bundle-bliz');
    expect(res.inserted_if_absent).toEqual(['blizzard_client_secret']);
  });
});

describe('apply-settings-overlay: applyOverlay full mode (sync failed or skipped)', () => {
  it('UPSERTs every key, overwriting what is there, as before', async () => {
    const { db, rows } = fakeDb(SYNCED);
    const res = await applyOverlay(db, FULL_OVERLAY);
    expect(rows.get('itad_api_key')).toBe('enc:bundle-itad');
    expect([...res.applied].sort()).toEqual(Object.keys(FULL_OVERLAY).sort());
    expect(res.inserted_if_absent).toEqual([]);
    expect(res.kept_synced).toEqual([]);
  });

  it('IDENTITY_KEYS is exactly the always-seeded identity + demo_mode set', () => {
    expect([...IDENTITY_KEYS].sort()).toEqual([...IDENTITY].sort());
  });
});

describe('apply-settings-overlay: parseOverlayArgs', () => {
  it('defaults to a full overlay', () => {
    expect(parseOverlayArgs([])).toEqual({ syncWins: false });
  });

  it('accepts --sync-wins', () => {
    expect(parseOverlayArgs(['--sync-wins'])).toEqual({ syncWins: true });
  });

  it('rejects an unknown flag loudly, including the retired --identity-only', () => {
    expect(() => parseOverlayArgs(['--sync'])).toThrow(/unknown argument/i);
    expect(() => parseOverlayArgs(['--identity-only'])).toThrow(
      /unknown argument/i,
    );
  });
});

describe('apply-settings-overlay: main() argv → mode', () => {
  const payload = JSON.stringify(FULL_OVERLAY);
  let logSpy: jest.SpyInstance;
  let savedUrl: string | undefined;
  beforeEach(() => {
    savedUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fake/db';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });
  const output = () =>
    JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as Record<
      string,
      unknown
    >;

  it('--sync-wins keeps the synced shared key and reports it by name', async () => {
    const fake = fakeDb(SYNCED);
    mockDb = fake.db;
    await expect(
      main(['--sync-wins'], () => Promise.resolve(payload)),
    ).resolves.toBeUndefined();
    expect(fake.rows.get('itad_api_key')).toBe('enc:synced-itad');
    expect(fake.rows.get('discord_bot_token')).toBe('enc:slot-tok');
    expect(output()).toMatchObject({
      sync_wins: true,
      kept_synced: ['itad_api_key'],
      kept_count: 1,
      inserted_if_absent: ['blizzard_client_secret'],
      inserted_count: 1,
      count: IDENTITY.length,
    });
  });

  it('no flag UPSERTs every key, overwriting the synced shared key', async () => {
    const fake = fakeDb(SYNCED);
    mockDb = fake.db;
    await main([], () => Promise.resolve(payload));
    expect(fake.rows.get('itad_api_key')).toBe('enc:bundle-itad');
    expect(output()).toMatchObject({ sync_wins: false, kept_count: 0 });
  });

  it('an unknown flag fails the run before anything is written', async () => {
    const fake = fakeDb(SYNCED);
    mockDb = fake.db;
    await expect(
      main(['--identity-only'], () => Promise.resolve(payload)),
    ).rejects.toThrow(/unknown argument: --identity-only/);
    expect(fake.rows.get('itad_api_key')).toBe('enc:synced-itad');
  });
});

describe('apply-settings-overlay: summarizeOverlay with sync-wins counts', () => {
  it('reports applied/inserted/kept NAMES and counts, never values', () => {
    const summary = summarizeOverlay(FULL_OVERLAY, {
      insertedIfAbsent: ['blizzard_client_secret'],
      keptSynced: ['itad_api_key'],
      syncWins: true,
    });
    expect([...summary.applied].sort()).toEqual([...IDENTITY].sort());
    expect(summary.count).toBe(5);
    expect(summary.inserted_count).toBe(1);
    expect(summary.kept_count).toBe(1);
    expect(summary.sync_wins).toBe(true);
    const serialized = JSON.stringify(summary);
    for (const v of ['bundle-itad', 'bundle-bliz', 'slot-tok', 'slot-sec']) {
      expect(serialized).not.toContain(v);
    }
  });
});

/**
 * ROK-2099 §5/§9 — `wow-addon-errors` companion messages against a real DB.
 * The production `WowAddonErrorsHandler` is registered by `WowCommonModule`;
 * nothing here stubs it. A device posts to `/companion/v1/messages/
 * wow-addon-errors` and each record lands as one row per (uploader, scrubbed
 * error): idempotent on a re-scan, widened by a later upload, re-scrubbed by
 * the server, isolated per user, refused for a session caller or with
 * `blizzard` inactive, and kept when the upload is switched off (ruling 8).
 *
 * Every message is built in-test; an unscrubbed path never sits in a
 * fixture file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  COMPANION_WOW_ADDON_ERRORS_MAX_BYTES,
  WOW_ADDON_ERRORS_CONTRACT_ID,
  WowAddonErrorsMessageSchema,
  type WowAddonErrorRecord,
  type WowAddonErrorsMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
} from '../../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { addonErrorRecordHash } from './wow-addon-errors.scrub';

const MESSAGES = `/companion/v1/messages/${WOW_ADDON_ERRORS_CONTRACT_ID}`;
const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/companion/wow-addon-errors/v1/fixtures',
);
/** Fixed and past: the fixture's own capturedAt can be ahead of a run. */
const CAPTURED = '2026-11-01T00:00:00Z';
const NIL_CALL =
  'Interface\\AddOns\\OpenMap\\Pins.lua:9: attempt to call a nil value';

/** The minimal golden fixture: a valid envelope + payload to vary. */
const BASE: WowAddonErrorsMessage = WowAddonErrorsMessageSchema.parse(
  JSON.parse(
    readFileSync(join(FIXTURES, 'buggrabber-minimal.json'), 'utf8'),
  ) as unknown,
);

const rec = (over: Partial<WowAddonErrorRecord> = {}): WowAddonErrorRecord => ({
  addon: 'OpenMap',
  message: NIL_CALL,
  firstSeenAt: '2026-10-30T08:00:00Z',
  lastSeenAt: '2026-10-30T09:00:00Z',
  count: 3,
  session: 5,
  ...over,
});

type Hint = { name: string; realm: string };

const message = (
  records: WowAddonErrorRecord[],
  hint?: Hint,
): WowAddonErrorsMessage => ({
  ...BASE,
  capturedAt: CAPTURED,
  payload: {
    ...BASE.payload,
    ...(hint ? { characterHint: hint } : {}),
    records,
  },
});

let testApp: TestApp;
const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  await plugins().ensureInstalled('blizzard');
  await plugins().activate('blizzard');
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A user, their session JWT and a linked device's `rlcd_` token. */
async function member(name: string) {
  const user = await makeUser(testApp, name);
  const device = await linkDevice(testApp, user.token);
  return { id: user.id, session: user.token, ...device };
}

const post = (token: string, body: unknown) =>
  testApp.request
    .post(MESSAGES)
    .set(bearer(token))
    .send(body as object);

const t = schema.wowAddonErrorRecords;
const rows = () => testApp.db.select().from(t).orderBy(t.id);

/** The widening columns of the row(s) as plain values. */
const view = async () =>
  (await rows()).map((r) => ({
    userId: r.userId,
    count: r.count,
    session: r.session,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));

/** The rows with `updatedAt` blanked: the upsert bumps it on every touch. */
const stable = async () =>
  (await rows()).map((r) => ({ ...r, updatedAt: null }));

function expectAccepted(res: { status: number; body: unknown }): void {
  expect({ status: res.status, body: res.body }).toEqual({
    status: 202,
    body: { status: 'accepted' },
  });
}

function expectError(
  res: { status: number; body: unknown },
  status: number,
  code: string,
): void {
  expect({
    status: res.status,
    code: (res.body as { code?: string }).code,
  }).toEqual({ status, code });
}

describe('idempotent upsert (AC1)', () => {
  it('the same message twice → 202 accepted both times, one row, nothing but updatedAt changed', async () => {
    const a = await member('ae-replay');
    const msg = message([rec()]);
    expectAccepted(await post(a.token, msg));
    const before = await stable();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      userId: a.id,
      deviceId: a.deviceId,
      addon: 'OpenMap',
      message: NIL_CALL,
      stack: null,
      count: 3,
      session: 5,
      source: 'buggrabber',
      sourceVersion: '12.1.1',
      accountKey: BASE.payload.accountKey,
      scrubbedCount: 0,
      recordHash: addonErrorRecordHash('OpenMap', NIL_CALL, null),
    });
    expectAccepted(await post(a.token, msg));
    expect(await stable()).toEqual(before);
  });

  it('a wider re-upload widens the row; a narrower one never shrinks it', async () => {
    const a = await member('ae-widen');
    expectAccepted(await post(a.token, message([rec()])));
    const wider = rec({
      count: 7,
      session: 9,
      firstSeenAt: '2026-10-30T07:00:00Z',
      lastSeenAt: '2026-10-30T10:00:00Z',
    });
    expectAccepted(await post(a.token, message([wider])));
    const widened = {
      userId: a.id,
      count: 7,
      session: 9,
      firstSeenAt: '2026-10-30T07:00:00.000Z',
      lastSeenAt: '2026-10-30T10:00:00.000Z',
    };
    expect(await view()).toEqual([widened]);
    const narrower = rec({
      count: 2,
      session: 1,
      firstSeenAt: '2026-10-30T08:30:00Z',
      lastSeenAt: '2026-10-30T08:45:00Z',
    });
    expectAccepted(await post(a.token, message([narrower])));
    expect(await view()).toEqual([widened]);
  });
});

describe('post-scrub collisions in one message', () => {
  it('two wire records that collide after the scrub → 202 accepted, one merged row', async () => {
    const a = await member('ae-collide');
    const hint = { name: 'Anabelle', realm: 'Doomhowl' };
    const res = await post(
      a.token,
      message(
        [
          rec({ message: 'Anabelle: attempt to index nil', count: 2 }),
          rec({
            message: '<char>: attempt to index nil',
            count: 4,
            firstSeenAt: '2026-10-30T06:00:00Z',
          }),
        ],
        hint,
      ),
    );
    expectAccepted(res);
    const [row] = nonEmpty(await rows(), 'merged row');
    expect(await rows()).toHaveLength(1);
    expect({
      message: row.message,
      count: row.count,
      firstSeenAt: row.firstSeenAt.toISOString(),
      scrubbedCount: row.scrubbedCount,
    }).toEqual({
      message: '<char>: attempt to index nil',
      count: 4,
      firstSeenAt: '2026-10-30T06:00:00.000Z',
      scrubbedCount: 1,
    });
  });
});

describe('server re-scrub (D8)', () => {
  it('a drive-less WoW install path the collector missed is stored as <wow>\\ and counted', async () => {
    const a = await member('ae-wowpath');
    const stack =
      '\\Games\\World of Warcraft\\_classic_era_\\Interface\\AddOns\\OpenMap\\Pins.lua:9: in function <Pins.lua:7>';
    expectAccepted(await post(a.token, message([rec({ stack })])));
    const [row] = nonEmpty(await rows(), 'scrubbed row');
    const stored =
      '<wow>\\Interface\\AddOns\\OpenMap\\Pins.lua:9: in function <Pins.lua:7>';
    expect({
      stack: row.stack,
      scrubbedCount: row.scrubbedCount,
      recordHash: row.recordHash,
    }).toEqual({
      stack: stored,
      scrubbedCount: 1,
      recordHash: addonErrorRecordHash('OpenMap', NIL_CALL, stored),
    });
  });

  it("the uploader's own character and realm in a record → <char> / <realm>", async () => {
    const a = await member('ae-names');
    const hint = { name: 'Anabelle', realm: 'Doomhowl' };
    const msg = message(
      [rec({ message: 'Anabelle-Doomhowl: attempt to index nil' })],
      hint,
    );
    expectAccepted(await post(a.token, msg));
    const [row] = nonEmpty(await rows(), 'scrubbed row');
    expect({
      message: row.message,
      scrubbedCount: row.scrubbedCount,
      characterName: row.characterName,
      characterRealm: row.characterRealm,
    }).toEqual({
      message: '<char>-<realm>: attempt to index nil',
      scrubbedCount: 2,
      characterName: 'Anabelle',
      characterRealm: 'Doomhowl',
    });
  });
});

describe('rejects → nothing written', () => {
  it(`a body over ${COMPANION_WOW_ADDON_ERRORS_MAX_BYTES} bytes → 413 payload_too_large`, async () => {
    const a = await member('ae-toolarge');
    const huge = message([
      rec({ stack: 'x'.repeat(COMPANION_WOW_ADDON_ERRORS_MAX_BYTES + 1) }),
    ]);
    expectError(await post(a.token, huge), 413, 'payload_too_large');
    expect(await rows()).toEqual([]);
  });

  // Built here, never a fixture file: an unscrubbed home folder.
  const HOME_USER = 'somebodyathome';
  const homeStack = `C:\\Users\\${HOME_USER}\\Games\\Interface\\AddOns\\OpenMap\\Pins.lua:9: in main chunk`;

  it.each<[string, () => unknown]>([
    [
      'an unscrubbed C:\\Users\\… home path in the stack',
      () => message([rec({ stack: homeStack })]),
    ],
    [
      'a record carrying `locals` (ruling 7)',
      () => {
        const valid = message([rec()]);
        const records = [{ ...rec(), locals: 'self = <table>' }];
        return { ...valid, payload: { ...valid.payload, records } };
      },
    ],
    [
      'firstSeenAt after lastSeenAt',
      () =>
        message([
          rec({
            firstSeenAt: '2026-10-30T10:00:00Z',
            lastSeenAt: '2026-10-30T09:00:00Z',
          }),
        ]),
    ],
  ])('%s → 400 invalid_payload', async (_label, build) => {
    const a = await member('ae-invalid');
    const res = await post(a.token, build());
    expectError(res, 400, 'invalid_payload');
    expect(JSON.stringify(res.body)).not.toContain(HOME_USER);
    expect(await rows()).toEqual([]);
  });
});

describe('cross-user isolation', () => {
  it("users A and B upload the identical record → two rows; B's re-upload never moves A's", async () => {
    const a = await member('ae-user-a');
    const b = await member('ae-user-b');
    expectAccepted(await post(a.token, message([rec()])));
    expectAccepted(await post(b.token, message([rec()])));
    const both = await rows();
    expect(both.map((r) => r.userId)).toEqual([a.id, b.id]);
    expect(new Set(both.map((r) => r.recordHash)).size).toBe(1);

    expectAccepted(await post(b.token, message([rec({ count: 50 })])));
    expect((await view()).map((r) => [r.userId, r.count])).toEqual([
      [a.id, 3],
      [b.id, 50],
    ]);
  });
});

describe("one member's second device (Codex P2/P3)", () => {
  it('the row follows the latest uploader whole and keeps the scrub evidence', async () => {
    const a = await member('ae-two-devices');
    const second = await linkDevice(testApp, a.session);
    const tail = ': attempt to index nil';
    const first = { name: 'Anabelle', realm: 'Doomhowl' };
    expectAccepted(
      await post(a.token, message([rec({ message: `<char>${tail}` })], first)),
    );
    const later = { name: 'Brynhild', realm: 'Stitches' };
    expectAccepted(
      await post(
        second.token,
        message([rec({ message: `Brynhild${tail}` })], later),
      ),
    );
    expect(
      (await rows()).map((r) => ({
        deviceId: r.deviceId,
        characterName: r.characterName,
        characterRealm: r.characterRealm,
        message: r.message,
        scrubbedCount: r.scrubbedCount,
      })),
    ).toEqual([
      {
        deviceId: second.deviceId,
        characterName: 'Brynhild',
        characterRealm: 'Stitches',
        message: `<char>${tail}`,
        scrubbedCount: 1,
      },
    ]);
  });
});

describe('auth and plugin gating', () => {
  it('a session JWT → 404 unknown_contract (device-only handler)', async () => {
    const a = await member('ae-session');
    expectError(
      await post(a.session, message([rec()])),
      404,
      'unknown_contract',
    );
    expect(await rows()).toEqual([]);
  });

  it('blizzard inactive → 404 unknown_contract, nothing written', async () => {
    const a = await member('ae-inactive');
    await plugins().deactivate('blizzard');
    try {
      expectError(
        await post(a.token, message([rec()])),
        404,
        'unknown_contract',
      );
      expect(await rows()).toEqual([]);
    } finally {
      // deactivate() drops the Forever identity provider (ROK-1733); only
      // activate() re-registers it.
      await plugins().activate('blizzard');
    }
  });

  it('ruling 8: rows stay while the upload is off (blizzard off, then back on)', async () => {
    const a = await member('ae-keep');
    expectAccepted(await post(a.token, message([rec()])));
    const before = await rows();
    expect(before).toHaveLength(1);
    await plugins().deactivate('blizzard');
    try {
      expect(await rows()).toEqual(before);
    } finally {
      await plugins().activate('blizzard');
    }
    expect(await rows()).toEqual(before);
  });
});

describe('foreign keys', () => {
  it('the device row deleted → the error rows stay with device_id NULL', async () => {
    const a = await member('ae-device-fk');
    expectAccepted(await post(a.token, message([rec()])));
    await testApp.db
      .delete(schema.companionDevices)
      .where(eq(schema.companionDevices.id, a.deviceId));
    expect(
      (await rows()).map((r) => ({ userId: r.userId, deviceId: r.deviceId })),
    ).toEqual([{ userId: a.id, deviceId: null }]);
  });

  it('the user deleted → their error rows cascade', async () => {
    const a = await member('ae-user-fk');
    const b = await member('ae-user-fk-other');
    expectAccepted(await post(a.token, message([rec()])));
    expectAccepted(await post(b.token, message([rec()])));
    await testApp.db.delete(schema.users).where(eq(schema.users.id, a.id));
    expect((await rows()).map((r) => r.userId)).toEqual([b.id]);
  });
});

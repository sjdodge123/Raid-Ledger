/**
 * ROK-1956 L4 — `POST /companion/v1/messages/:contract` against a real DB
 * (spec §10 I-1…I-13). No production module registers a companion handler
 * (D-4), so this file registers one for `bg3-save` v1, owned by an active
 * plugin. Fixtures are the shipped anonymised `bg3-save/v1` ones only.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { HttpException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Response } from 'supertest';
import { z } from 'zod';
import {
  BG3_SAVE_CONTRACT_ID,
  Bg3SaveMessageSchema,
  COMPANION_BG3_SAVE_MAX_BYTES,
  COMPANION_MESSAGE_MAX_BYTES,
  CompanionIngestAckSchema,
  CompanionIngestErrorSchema,
  type Bg3SaveMessage,
  type CompanionContractTable,
  type CompanionContractVersionSpec,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
  withEnv,
} from '../devices/testing/companion-link.helpers';
import {
  CompanionHandlerRegistry,
  type CompanionContractHandler,
  type CompanionHandlerContext,
} from './companion-handler.registry';
import { CompanionIngestLatestRepository } from './companion-ingest-latest.repository';
import type { CompanionIngestVia } from './companion-ingest-request';
import { CompanionIngestService } from './companion-ingest.service';

const MESSAGES = '/companion/v1/messages';
const OWNER = PELICAN_PLUGIN_ID;
const FIXTURES = join(__dirname, '../../../../packages/contract/companion');
const BG3_FIXTURES = join(FIXTURES, 'bg3-save/v1/fixtures');

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8')) as unknown;

const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  readJson(join(BG3_FIXTURES, 'act2-party-4p-summon.json')),
);
const EXPECTED = z
  .record(z.string(), z.object({ path: z.string(), code: z.string() }))
  .parse(readJson(join(BG3_FIXTURES, 'invalid/EXPECTED.json')));

/** savedAt values for the latest-wins cases (T1 < T2 < T3 < LATE). */
const T1 = '2026-10-24T11:00:00Z';
const T2 = '2026-10-24T12:00:00Z';
const T3 = '2026-10-24T13:00:00Z';
const LATE = '2026-10-24T14:00:00Z';
const KEY_B =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

let testApp: TestApp;

const handle = jest.fn<
  Promise<void>,
  [CompanionHandlerContext, Bg3SaveMessage]
>();
let sources: readonly CompanionIngestVia[] = ['device'];
const handler: CompanionContractHandler<Bg3SaveMessage> = {
  contract: BG3_SAVE_CONTRACT_ID,
  versions: [1],
  // Read per resolve, so each case picks its sources (Q2).
  get sources() {
    return sources;
  },
  latestWins: (m) => ({
    key: m.payload.campaignKey,
    at: new Date(m.payload.savedAt),
  }),
  handle: (ctx, m) => handle(ctx, m),
};

beforeAll(async () => {
  testApp = await getTestApp();
  testApp.app.get(CompanionHandlerRegistry).register(OWNER, handler);
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  sources = ['device'];
  handle.mockReset();
  handle.mockResolvedValue(undefined);
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(OWNER);
  await plugins.activate(OWNER);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A bg3 message built from the act2 fixture. */
function bg3(
  over: { savedAt?: string; capturedAt?: string; campaignKey?: string } = {},
): Bg3SaveMessage {
  return {
    ...ACT2,
    capturedAt: over.capturedAt ?? ACT2.capturedAt,
    payload: {
      ...ACT2.payload,
      savedAt: over.savedAt ?? ACT2.payload.savedAt,
      campaignKey: over.campaignKey ?? ACT2.payload.campaignKey,
    },
  };
}

const buf = (v: unknown): Buffer => Buffer.from(JSON.stringify(v));

/** `v` as JSON padded with trailing spaces to exactly `size` bytes. */
function padded(v: unknown, size: number): Buffer {
  const json = JSON.stringify(v);
  const pad = size - Buffer.byteLength(json);
  if (pad < 0) throw new Error(`padded: JSON already ${json.length} bytes`);
  return Buffer.from(json + ' '.repeat(pad));
}

interface PostOpts {
  token?: string;
  contentType?: string;
  encoding?: string;
}

function post(contract: string, body: Buffer, opts: PostOpts = {}) {
  let r = testApp.request
    .post(`${MESSAGES}/${contract}`)
    .set('Content-Type', opts.contentType ?? 'application/json');
  if (opts.token !== undefined) r = r.set(bearer(opts.token));
  if (opts.encoding !== undefined) r = r.set('Content-Encoding', opts.encoding);
  return r.send(body);
}

const postBg3 = (token: string, msg: Bg3SaveMessage = ACT2) =>
  post(BG3_SAVE_CONTRACT_ID, buf(msg), { token });

/** 202 with the given ack status. */
function expectAck(res: Response, status: 'accepted' | 'stale'): void {
  expect([res.status, res.body]).toEqual([202, { status }]);
  expect(CompanionIngestAckSchema.safeParse(res.body).success).toBe(true);
}

/** The §9 error answer: status + code, a wire-valid body, connection closed. */
function expectError(res: Response, status: number, code: string): void {
  const body = res.body as { code?: unknown };
  expect([res.status, body.code]).toEqual([status, code]);
  expect(CompanionIngestErrorSchema.safeParse(res.body).success).toBe(true);
  expect(res.headers['connection']).toBe('close');
}

/** A member with one linked device. */
async function member(name: string) {
  const user = await makeUser(testApp, name);
  const device = await linkDevice(testApp, user.token);
  return { id: user.id, session: user.token, ...device };
}

async function latestRows() {
  const rows = await testApp.db.select().from(schema.companionIngestLatest);
  return rows
    .map((r) => [r.userId, r.contract, r.latestKey, r.latestAt.toISOString()])
    .sort((a, b) => a.join('|').localeCompare(b.join('|')));
}

const iso = (t: string): string => new Date(t).toISOString();

/** savedAt of every message the handler received, in call order. */
const handledSavedAt = (): string[] =>
  handle.mock.calls.map(([, m]) => m.payload.savedAt);

/** A service wired to a synthetic table (DI default is the shipped one). */
function serviceWith(table: CompanionContractTable) {
  const plugins = testApp.app.get(PluginRegistryService);
  const registry = new CompanionHandlerRegistry(plugins, table);
  const repo = testApp.app.get(CompanionIngestLatestRepository);
  return {
    registry,
    service: new CompanionIngestService(registry, repo, table),
  };
}

/** The HttpException a promise rejects with (fails loudly otherwise). */
async function rejection(
  p: Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err: unknown) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() };
    }
    throw err;
  }
  throw new Error('expected the ingest to reject');
}

describe('I-1 a valid message', () => {
  it('device token + act2 fixture → 202 accepted; handler called once with the parsed message', async () => {
    const m = await member('ci-valid');
    expectAck(await postBg3(m.token), 'accepted');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: m.id,
        via: 'device',
        deviceId: m.deviceId,
        receivedAt: expect.any(Date) as unknown,
      }),
      ACT2,
    );
  });

  it('a gzip-encoded copy → 202 accepted', async () => {
    const m = await member('ci-gzip');
    const res = await post(BG3_SAVE_CONTRACT_ID, gzipSync(buf(ACT2)), {
      token: m.token,
      encoding: 'gzip',
    });
    expectAck(res, 'accepted');
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: m.id }),
      ACT2,
    );
  });
});

describe('I-2 every invalid bg3-save fixture', () => {
  it('EXPECTED.json lists every invalid fixture (none silently skipped)', () => {
    const files = readdirSync(join(BG3_FIXTURES, 'invalid'))
      .filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json')
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect(files).toEqual(Object.keys(EXPECTED).sort());
  });

  // An envelope-level issue fails stage one (invalid_envelope); the v2
  // fixture is a valid envelope whose version is unknown (step 6, I-4);
  // everything under `payload` fails the full schema (invalid_payload).
  const outcomeOf = (path: string): [number, string] => {
    if (path === 'contractVersion') return [404, 'unknown_contract_version'];
    return path.startsWith('payload')
      ? [400, 'invalid_payload']
      : [400, 'invalid_envelope'];
  };

  it.each(Object.entries(EXPECTED))(
    '%s → the documented error; handler not called',
    async (name, issue) => {
      const m = await member(`ci-inv-${name.slice(0, 20)}`);
      const raw = readFileSync(join(BG3_FIXTURES, 'invalid', `${name}.json`));
      const res = await post(BG3_SAVE_CONTRACT_ID, raw, { token: m.token });
      const [status, code] = outcomeOf(issue.path);
      expectError(res, status, code);
      if (status === 400) {
        expect((res.body as { issues?: unknown }).issues).toEqual(
          expect.arrayContaining([issue]),
        );
      }
      expect(handle).not.toHaveBeenCalled();
    },
  );
});

describe('I-3 unknown contracts', () => {
  it('the envelope unknown-contract fixture posted to /minecraft-world → 404 unknown_contract', async () => {
    const m = await member('ci-unknown');
    const raw = readFileSync(
      join(FIXTURES, 'envelope/v1/fixtures/unknown-contract.json'),
    );
    expectError(
      await post('minecraft-world', raw, { token: m.token }),
      404,
      'unknown_contract',
    );
  });

  it('/__proto__ → 404 unknown_contract', async () => {
    const m = await member('ci-proto');
    expectError(
      await post('__proto__', buf(ACT2), { token: m.token }),
      404,
      'unknown_contract',
    );
  });

  it('/BG3 → 404 before the body is read (a text/plain non-JSON body is not 415/400)', async () => {
    const m = await member('ci-upper');
    const res = await post('BG3', Buffer.from('not json'), {
      token: m.token,
      contentType: 'text/plain',
    });
    expectError(res, 404, 'unknown_contract');
  });

  it('a bg3 body posted to another contract path → 400 invalid_envelope (D-9)', async () => {
    const m = await member('ci-mismatch');
    expectError(
      await post('minecraft-world', buf(ACT2), { token: m.token }),
      400,
      'invalid_envelope',
    );
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('I-4 versions', () => {
  it('bg3-save v2 → 404 unknown_contract_version with currentVersion 1', async () => {
    const m = await member('ci-v2');
    const res = await post(
      BG3_SAVE_CONTRACT_ID,
      buf({ ...ACT2, contractVersion: 2 }),
      {
        token: m.token,
      },
    );
    expectError(res, 404, 'unknown_contract_version');
    expect(res.body).toMatchObject({ currentVersion: 1 });
  });

  it('test-retired v1 (synthetic table) → 409 retired_contract_version with currentVersion 2', async () => {
    const user = await makeUser(testApp, 'ci-retired');
    const spec = (
      status: CompanionContractVersionSpec['status'],
    ): CompanionContractVersionSpec => ({
      schema: z.unknown(),
      maxBytes: COMPANION_BG3_SAVE_MAX_BYTES,
      blobSlots: [],
      status,
    });
    const table: CompanionContractTable = {
      'test-retired': { 1: spec('retired'), 2: spec('current') },
    };
    const { service } = serviceWith(table);
    const body = buf({
      ...ACT2,
      contract: 'test-retired',
      contractVersion: 1,
    });
    const auth = {
      userId: user.id,
      via: 'device' as const,
      deviceId: null,
      tokenHash: null,
    };
    expect(await rejection(service.ingest(auth, 'test-retired', body))).toEqual(
      {
        status: 409,
        body: expect.objectContaining({
          code: 'retired_contract_version',
          currentVersion: 2,
        }) as unknown,
      },
    );
  });
});

describe('I-5 disabled contracts', () => {
  it('owner plugin deactivated → 404 unknown_contract; handler not called', async () => {
    const m = await member('ci-plugin-off');
    const plugins = testApp.app.get(PluginRegistryService);
    await plugins.deactivate(OWNER);
    try {
      expectError(await postBg3(m.token), 404, 'unknown_contract');
      expect(handle).not.toHaveBeenCalled();
    } finally {
      await plugins.activate(OWNER);
    }
  });

  it('no handler registered for the contract → 404 unknown_contract', async () => {
    const m = await member('ci-no-handler');
    const { service } = serviceWith({
      [BG3_SAVE_CONTRACT_ID]: {
        1: {
          schema: Bg3SaveMessageSchema,
          maxBytes: COMPANION_BG3_SAVE_MAX_BYTES,
          blobSlots: ['thumbnail'],
          status: 'current',
        },
      },
    });
    const auth = {
      userId: m.id,
      via: 'device' as const,
      deviceId: m.deviceId,
      tokenHash: null,
    };
    const out = await rejection(
      service.ingest(auth, BG3_SAVE_CONTRACT_ID, buf(ACT2)),
    );
    expect(out).toEqual({
      status: 404,
      body: expect.objectContaining({ code: 'unknown_contract' }) as unknown,
    });
    expect(await latestRows()).toEqual([]);
  });
});

describe('I-6 size caps and encodings', () => {
  it(`an identity body of ${COMPANION_MESSAGE_MAX_BYTES + 1} bytes → 413 (never parsed)`, async () => {
    const m = await member('ci-global-cap');
    const res = await post(
      BG3_SAVE_CONTRACT_ID,
      Buffer.alloc(COMPANION_MESSAGE_MAX_BYTES + 1, 'x'),
      { token: m.token },
    );
    expectError(res, 413, 'payload_too_large');
  });

  it('a gzip body inflating one byte past the global cap → 413, not invalid_envelope', async () => {
    const m = await member('ci-inflate-cap');
    const bomb = gzipSync(Buffer.alloc(COMPANION_MESSAGE_MAX_BYTES + 1, 'x'));
    const res = await post(BG3_SAVE_CONTRACT_ID, bomb, {
      token: m.token,
      encoding: 'gzip',
    });
    expectError(res, 413, 'payload_too_large');
  });

  it('a gzip bomb (2 MB of spaces) → 413', async () => {
    const m = await member('ci-bomb');
    const res = await post(
      BG3_SAVE_CONTRACT_ID,
      gzipSync(Buffer.alloc(2_000_000, 0x20)),
      { token: m.token, encoding: 'gzip' },
    );
    expectError(res, 413, 'payload_too_large');
  });

  it(`a valid bg3 message padded to ${COMPANION_BG3_SAVE_MAX_BYTES + 1} bytes → 413; exactly at the cap → 202`, async () => {
    const m = await member('ci-contract-cap');
    const over = padded(ACT2, COMPANION_BG3_SAVE_MAX_BYTES + 1);
    expectError(
      await post(BG3_SAVE_CONTRACT_ID, over, { token: m.token }),
      413,
      'payload_too_large',
    );
    expect(handle).not.toHaveBeenCalled();
    const atCap = padded(ACT2, COMPANION_BG3_SAVE_MAX_BYTES);
    expectAck(
      await post(BG3_SAVE_CONTRACT_ID, atCap, { token: m.token }),
      'accepted',
    );
  });

  it('the per-contract cap runs after the lookup: an unknown contract padded past it → 404', async () => {
    const m = await member('ci-cap-order');
    const unknown = readJson(
      join(FIXTURES, 'envelope/v1/fixtures/unknown-contract.json'),
    );
    const res = await post(
      'minecraft-world',
      padded(unknown, COMPANION_BG3_SAVE_MAX_BYTES + 1),
      { token: m.token },
    );
    expectError(res, 404, 'unknown_contract');
  });

  it('a body that is not gzip under Content-Encoding: gzip → 400 invalid_envelope', async () => {
    const m = await member('ci-bad-gzip');
    const res = await post(
      BG3_SAVE_CONTRACT_ID,
      Buffer.from('not gzip at all'),
      {
        token: m.token,
        encoding: 'gzip',
      },
    );
    expectError(res, 400, 'invalid_envelope');
  });

  it('invalid UTF-8 → 400 invalid_envelope (strict decoder)', async () => {
    const m = await member('ci-utf8');
    const bytes = buf(ACT2);
    const at = bytes.indexOf('QuickSave_1');
    if (at < 0) throw new Error('fixture saveName moved');
    bytes[at] = 0xff; // a lone 0xFF is never valid UTF-8
    expectError(
      await post(BG3_SAVE_CONTRACT_ID, bytes, { token: m.token }),
      400,
      'invalid_envelope',
    );
  });
});

describe('I-7 auth failures → 401 unauthorized', () => {
  it('no Authorization header', async () => {
    expectError(
      await post(BG3_SAVE_CONTRACT_ID, buf(ACT2)),
      401,
      'unauthorized',
    );
  });

  it('a JWT-shaped garbage bearer', async () => {
    const res = await post(BG3_SAVE_CONTRACT_ID, buf(ACT2), {
      token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.not-a-signature',
    });
    expectError(res, 401, 'unauthorized');
  });

  it('a revoked device', async () => {
    const m = await member('ci-revoked');
    const del = await testApp.request
      .delete(`/companion/v1/devices/${m.deviceId}`)
      .set(bearer(m.session));
    expect(del.status).toBe(204);
    expectError(await postBg3(m.token), 401, 'unauthorized');
    expect(handle).not.toHaveBeenCalled();
  });

  it("a deactivated owner's device", async () => {
    const m = await member('ci-deactivated');
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, m.id));
    expectError(await postBg3(m.token), 401, 'unauthorized');
    expect(handle).not.toHaveBeenCalled();
  });

  it('a revoke landing between the guard and the commit → 401, nothing written', async () => {
    const m = await member('ci-revoke-race');
    const repo = testApp.app.get(CompanionIngestLatestRepository);
    const real = repo.holdDevice.bind(repo);
    jest.spyOn(repo, 'holdDevice').mockImplementationOnce(async (tx, auth) => {
      await testApp.db
        .update(schema.companionDevices)
        .set({ revokedAt: new Date() })
        .where(eq(schema.companionDevices.id, m.deviceId));
      return real(tx, auth);
    });
    expectError(await postBg3(m.token), 401, 'unauthorized');
    expect(handle).not.toHaveBeenCalled();
    expect(await latestRows()).toEqual([]);
  });
});

describe('I-8 the session path', () => {
  it('a session JWT → 202 when the handler opts into session; ctx.via is session', async () => {
    sources = ['device', 'session'];
    const user = await makeUser(testApp, 'ci-session');
    expectAck(await postBg3(user.token), 'accepted');
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        via: 'session',
        deviceId: null,
      }),
      ACT2,
    );
  });

  it('a session JWT → 404 unknown_contract when the handler is device-only (default)', async () => {
    const user = await makeUser(testApp, 'ci-session-off');
    expectError(await postBg3(user.token), 404, 'unknown_contract');
    expect(handle).not.toHaveBeenCalled();
  });

  it('an impersonation session is refused even when session is opted in → 401', async () => {
    sources = ['device', 'session'];
    const target = await makeUser(testApp, 'ci-imp-target');
    const [admin] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:ci-imp-admin@test.local',
          username: 'ci-imp-admin',
          role: 'admin',
        })
        .returning({ id: schema.users.id }),
      'admin',
    );
    const token = await signTestAccessToken(testApp, {
      sub: target.id,
      username: 'ci-imp-target',
      role: 'member',
      impersonatedBy: admin.id,
    });
    expectError(await postBg3(token), 401, 'unauthorized');
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('I-9 latest-wins per (user, contract, campaignKey)', () => {
  it('newer replaces; older and equal are stale and skip the handler; per user', async () => {
    const a = await member('ci-lw-a');
    const at = (savedAt: string) => bg3({ savedAt, capturedAt: LATE });
    expectAck(await postBg3(a.token, at(T2)), 'accepted');
    expectAck(await postBg3(a.token, at(T1)), 'stale');
    expectAck(await postBg3(a.token, at(T2)), 'stale');
    expectAck(await postBg3(a.token, at(T3)), 'accepted');
    expect(handledSavedAt()).toEqual([T2, T3]);

    const b = await member('ci-lw-b');
    expectAck(await postBg3(b.token, at(T1)), 'accepted');
    const key = ACT2.payload.campaignKey;
    expect(await latestRows()).toEqual(
      [
        [a.id, BG3_SAVE_CONTRACT_ID, key, iso(T3)],
        [b.id, BG3_SAVE_CONTRACT_ID, key, iso(T1)],
      ].sort((x, y) => x.join('|').localeCompare(y.join('|'))),
    );
  });

  it('another campaignKey of the same user has its own marker', async () => {
    const a = await member('ci-lw-keys');
    expectAck(
      await postBg3(a.token, bg3({ savedAt: T3, capturedAt: LATE })),
      'accepted',
    );
    const other = bg3({ savedAt: T1, capturedAt: LATE, campaignKey: KEY_B });
    expectAck(await postBg3(a.token, other), 'accepted');
  });

  it('out-of-order concurrent uploads keep the newest; every handled one was accepted', async () => {
    const a = await member('ci-lw-race');
    const at = (savedAt: string) => bg3({ savedAt, capturedAt: LATE });
    const responses = await Promise.all(
      [T1, T3, T2].map((t) => postBg3(a.token, at(t))),
    );
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
    const statuses = responses.map(
      (r) => CompanionIngestAckSchema.parse(r.body).status,
    );
    expect(statuses[1]).toBe('accepted');
    const accepted = statuses.filter((s) => s === 'accepted').length;
    expect(handle).toHaveBeenCalledTimes(accepted);
    expect(handledSavedAt()).toContain(T3);
    expect(await latestRows()).toEqual([
      [a.id, BG3_SAVE_CONTRACT_ID, ACT2.payload.campaignKey, iso(T3)],
    ]);
  });
});

describe('I-10 the clock rule', () => {
  it('capturedAt 10 min ahead → 400 captured_at_in_future; 1 min ahead → 202', async () => {
    const m = await member('ci-clock');
    const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
    expectError(
      await postBg3(m.token, bg3({ capturedAt: ahead(10 * 60_000) })),
      400,
      'captured_at_in_future',
    );
    expect(handle).not.toHaveBeenCalled();
    expectAck(
      await postBg3(m.token, bg3({ capturedAt: ahead(60_000) })),
      'accepted',
    );
  });
});

describe('I-11 rate limits', () => {
  it('per device: the third request with a limit of 2 → 429 + Retry-After; another device is unaffected', async () => {
    await withEnv(
      { COMPANION_INGEST_RATE_MESSAGES_PER_DEVICE_PER_MIN: '2' },
      async () => {
        const m = await member('ci-rate-dev');
        expectAck(await postBg3(m.token), 'accepted');
        expectAck(await postBg3(m.token), 'stale');
        const res = await postBg3(m.token);
        expectError(res, 429, 'rate_limited');
        expect(res.headers['retry-after']).toBeDefined();
        const second = await linkDevice(testApp, m.session);
        expectAck(await postBg3(second.token), 'stale');
      },
    );
  });

  it('per user: two devices of one user share the user budget; another user does not', async () => {
    await withEnv(
      { COMPANION_INGEST_RATE_MESSAGES_PER_USER_PER_MIN: '2' },
      async () => {
        const m = await member('ci-rate-user');
        const second = await linkDevice(testApp, m.session);
        expectAck(await postBg3(m.token), 'accepted');
        expectAck(await postBg3(m.token), 'stale');
        const res = await postBg3(second.token);
        expectError(res, 429, 'rate_limited');
        expect(res.headers['retry-after']).toBeDefined();
        const other = await member('ci-rate-other');
        expectAck(await postBg3(other.token), 'accepted');
      },
    );
  });
});

describe('I-12 media type and encoding', () => {
  it('Content-Type text/plain → 415 unsupported_media', async () => {
    const m = await member('ci-415-type');
    const res = await post(BG3_SAVE_CONTRACT_ID, buf(ACT2), {
      token: m.token,
      contentType: 'text/plain',
    });
    expectError(res, 415, 'unsupported_media');
  });

  it('Content-Encoding br → 415 unsupported_media', async () => {
    const m = await member('ci-415-br');
    const res = await post(BG3_SAVE_CONTRACT_ID, buf(ACT2), {
      token: m.token,
      encoding: 'br',
    });
    expectError(res, 415, 'unsupported_media');
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('I-13 a handler that throws', () => {
  it('→ 500 generic body; the latest marker does not advance (tx rolled back)', async () => {
    const m = await member('ci-throw');
    handle.mockRejectedValueOnce(new Error('handler exploded: secret detail'));
    const res = await postBg3(m.token);
    expect([res.status, res.body]).toEqual([
      500,
      { statusCode: 500, message: 'Internal server error' },
    ]);
    expect(res.headers['connection']).toBe('close');
    expect(await latestRows()).toEqual([]);
    // The same save is still new: it would be `stale` had the marker moved.
    expectAck(await postBg3(m.token), 'accepted');
    expect(handle).toHaveBeenCalledTimes(2);
  });
});

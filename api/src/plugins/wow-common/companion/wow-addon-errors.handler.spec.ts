/**
 * ROK-2099 §5 — `wow-addon-errors` handler: row mapping (re-scrub + hash),
 * in-batch collapse, and the upsert shape. The real upsert against Postgres
 * is the integration spec's job (S2a part 2).
 */
import type { WowAddonErrorsMessage } from '@raid-ledger/contract';
import type { CompanionHandlerContext } from '../../../companion/ingest/companion-handler.registry';
import {
  WowAddonErrorsHandler,
  collapseByHash,
  toAddonErrorRow,
} from './wow-addon-errors.handler';
import { addonErrorRecordHash } from './wow-addon-errors.scrub';

type Payload = WowAddonErrorsMessage['payload'];
type Rec = Payload['records'][number];

const rec = (over: Partial<Rec> = {}): Rec => ({
  addon: 'Foo',
  message: 'Interface\\AddOns\\Foo\\a.lua:1: Thrall broke it',
  stack: '[string "Thrall"]:1',
  firstSeenAt: '2026-11-01T10:00:00.000Z',
  lastSeenAt: '2026-11-02T10:00:00.000Z',
  count: 3,
  session: 7,
  ...over,
});

const payload = (records: Rec[]): Payload => ({
  source: 'buggrabber',
  sourceVersion: '12.1.1',
  accountKey: 'a'.repeat(64),
  characterHint: { name: 'Thrall', realm: 'Nightslayer' },
  records,
});

const CTX = { userId: 5, deviceId: 9 };

describe('toAddonErrorRow', () => {
  it("re-scrubs the uploader's name, hashes the scrubbed text and counts replacements", () => {
    const row = toAddonErrorRow(CTX, payload([rec()]), rec());
    expect(row.message).toBe(
      'Interface\\AddOns\\Foo\\a.lua:1: <char> broke it',
    );
    expect(row.stack).toBe('[string "<char>"]:1');
    expect(row.scrubbedCount).toBe(2);
    expect(row.recordHash).toBe(
      addonErrorRecordHash('Foo', row.message, row.stack ?? null),
    );
    expect(row).toMatchObject({
      userId: 5,
      deviceId: 9,
      characterName: 'Thrall',
      characterRealm: 'Nightslayer',
      source: 'buggrabber',
      count: 3,
      session: 7,
    });
  });

  it('an absent stack / session / hint maps to null', () => {
    const p = payload([]);
    delete p.characterHint;
    const r = rec();
    delete r.stack;
    delete r.session;
    const row = toAddonErrorRow(CTX, p, r);
    expect(row.stack).toBeNull();
    expect(row.session).toBeNull();
    expect(row.characterName).toBeNull();
    expect(row.message).toContain('Thrall');
  });
});

describe('collapseByHash', () => {
  it('merges records that collide after the scrub: max count/session/last, min first', () => {
    const p = payload([]);
    const a = toAddonErrorRow(
      CTX,
      p,
      rec({ message: 'Thrall died', count: 2, session: 9 }),
    );
    const b = toAddonErrorRow(
      CTX,
      p,
      rec({
        message: '<char> died',
        count: 5,
        session: 4,
        firstSeenAt: '2026-10-01T00:00:00.000Z',
        lastSeenAt: '2026-11-03T00:00:00.000Z',
      }),
    );
    const out = collapseByHash([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      count: 5,
      session: 9,
      firstSeenAt: new Date('2026-10-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-11-03T00:00:00.000Z'),
    });
  });
});

describe('collapseByHash lock order', () => {
  it('returns rows sorted by recordHash whatever the input order', () => {
    const p = payload([]);
    const rows = ['alpha', 'bravo', 'charlie', 'delta'].map((m) =>
      toAddonErrorRow(CTX, p, rec({ message: m })),
    );
    const hashes = rows.map((r) => r.recordHash).sort();
    expect(collapseByHash(rows).map((r) => r.recordHash)).toEqual(hashes);
    expect(
      collapseByHash([...rows].reverse()).map((r) => r.recordHash),
    ).toEqual(hashes);
  });
});

describe('WowAddonErrorsHandler.handle', () => {
  it('one upsert on (user_id, record_hash) with GREATEST/LEAST, device-only source', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn(() => ({ onConflictDoUpdate }));
    const insert = jest.fn(() => ({ values }));
    const handler = new WowAddonErrorsHandler();
    expect(handler.contract).toBe('wow-addon-errors');
    expect(handler.sources).toEqual(['device']);
    const ctx = {
      ...CTX,
      tx: { insert },
      via: 'device',
      receivedAt: new Date(),
    } as unknown as CompanionHandlerContext;
    const msg = {
      payload: payload([rec(), rec({ message: 'other' })]),
    } as WowAddonErrorsMessage;
    await handler.handle(ctx, msg);
    expect(insert).toHaveBeenCalledTimes(1);
    const firstValues = values.mock.calls[0] as unknown as [unknown[]];
    expect(firstValues[0]).toHaveLength(2);
    const conflictArg = onConflictDoUpdate.mock.calls[0]?.[0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(conflictArg.target).toHaveLength(2);
    expect(Object.keys(conflictArg.set).sort()).toEqual([
      'accountKey',
      'characterName',
      'characterRealm',
      'count',
      'deviceId',
      'firstSeenAt',
      'lastSeenAt',
      'scrubbedCount',
      'session',
      'source',
      'sourceVersion',
      'updatedAt',
    ]);
  });
});

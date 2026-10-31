/**
 * ROK-1597 item 4: the copy-id fallback when `calendarView` ignores
 * `$expand=singleValueExtendedProperties` (undocumented there).
 */
import * as microsoftHttp from './microsoft-http';
import type { MicrosoftHttpResponse } from './microsoft-http';
import {
  buildCopyPropLookupUrl,
  MICROSOFT_COPY_ID_LOOKUP_MAX,
  resolveCopyIds,
} from './microsoft-copy-id-fallback.helpers';
import { normalizeGraphEvent } from './microsoft-normalize.helpers';
import { RL_COPY_PROP_ID } from './microsoft-graph.constants';
import { ProviderAuthError } from '../calendar-provider.errors';

const COPY_ID = 'rl:0123456789ab:42:7';
const reply = (status: number, json: unknown): MicrosoftHttpResponse => ({
  status,
  json,
  retryAfter: null,
});
const occurrence = (id: string, showAs = 'busy') => ({
  id,
  showAs,
  isAllDay: false,
  start: { dateTime: '2026-11-03T18:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-11-03T20:00:00.0000000', timeZone: 'UTC' },
});
const ourProp = [{ id: RL_COPY_PROP_ID, value: COPY_ID }];

/** Answers each lookup GET by event id; counts calls. */
function spyLookups(byId: Record<string, MicrosoftHttpResponse>) {
  return jest
    .spyOn(microsoftHttp, 'microsoftJsonRequest')
    .mockImplementation((_m, url) => {
      const id = decodeURIComponent(
        /\/me\/events\/([^?]+)/.exec(url)?.[1] ?? '',
      );
      return Promise.resolve(byId[id] ?? reply(200, { id }));
    });
}

afterEach(() => jest.restoreAllMocks());

describe('resolveCopyIds', () => {
  it('keeps the fast path when any occurrence carries the expanded array', async () => {
    const spy = spyLookups({});
    const items = [
      { ...occurrence('e1'), singleValueExtendedProperties: [] },
      occurrence('e2'),
    ];
    const out = await resolveCopyIds('tok', items);
    expect([out.path, out.lookups, spy.mock.calls.length]).toEqual([
      'expand',
      0,
      0,
    ]);
  });

  it('falls back per busy occurrence when no item carries the array, and finds our copy', async () => {
    const spy = spyLookups({
      e2: reply(200, { id: 'e2', singleValueExtendedProperties: ourProp }),
    });
    const items = [
      occurrence('e1'),
      occurrence('e2'),
      occurrence('e3', 'free'),
    ];
    const out = await resolveCopyIds('tok', items);
    expect([out.path, out.lookups, out.capped]).toEqual(['fallback', 2, false]);
    expect(spy.mock.calls.map((c) => c[1])).toEqual([
      buildCopyPropLookupUrl('e1'),
      buildCopyPropLookupUrl('e2'),
    ]);
    const blocks = out.items.map((i) => normalizeGraphEvent(i));
    expect(blocks.map((b) => b?.ourId)).toEqual([
      undefined,
      COPY_ID,
      undefined,
    ]);
  });

  it('sends our property id with its exact minted casing', () => {
    const url = decodeURIComponent(buildCopyPropLookupUrl('e1'));
    expect(url).toContain(`$filter=id eq '${RL_COPY_PROP_ID}'`);
    expect(url).toContain('Name rlCopyId');
  });

  it('stops at the lookup cap and reports it', async () => {
    const spy = spyLookups({});
    const n = MICROSOFT_COPY_ID_LOOKUP_MAX + 2;
    const items = Array.from({ length: n }, (_, i) => occurrence(`e${i}`));
    const out = await resolveCopyIds('tok', items);
    expect(spy).toHaveBeenCalledTimes(MICROSOFT_COPY_ID_LOOKUP_MAX);
    expect([out.lookups, out.capped, out.items.length]).toEqual([
      MICROSOFT_COPY_ID_LOOKUP_MAX,
      true,
      n,
    ]);
  });

  it('a lookup 404 reads as "not our copy"; a 401 fails the read', async () => {
    spyLookups({ gone: reply(404, null), auth: reply(401, null) });
    const ok = await resolveCopyIds('tok', [occurrence('gone')]);
    expect(normalizeGraphEvent(ok.items[0])?.ourId).toBeUndefined();
    await expect(
      resolveCopyIds('tok', [occurrence('auth')]),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('an empty read makes no request', async () => {
    const spy = spyLookups({});
    await expect(resolveCopyIds('tok', [])).resolves.toMatchObject({
      path: 'none',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ourCopyIdOf casing (Graph may return a different case)', () => {
  it('matches the returned property id case-insensitively', () => {
    const event = {
      ...occurrence('e1'),
      singleValueExtendedProperties: [
        { id: RL_COPY_PROP_ID.toUpperCase(), value: COPY_ID },
      ],
    };
    expect(normalizeGraphEvent(event)?.ourId).toBe(COPY_ID);
  });
});

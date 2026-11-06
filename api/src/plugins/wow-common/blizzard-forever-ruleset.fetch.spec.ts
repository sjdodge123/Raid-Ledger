import { fetchForeverRulesetRaw } from './blizzard-forever-ruleset.fetch';

/**
 * ROK-2100 — the realmless Forever profile call classifies every outcome
 * without throwing: 200 → found (raw `ruleset`), 404/403 → absent (cacheable),
 * any other status / abort / network → error (transient).
 */
function logger() {
  return { debug: jest.fn(), warn: jest.fn() };
}

function mockResponse(status: number, body: unknown = {}) {
  return jest
    .spyOn(global, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );
}

const call = (log = logger()) =>
  fetchForeverRulesetRaw(
    'Ana Forever',
    'us',
    'tok',
    new AbortController().signal,
    log,
  );

afterEach(() => jest.restoreAllMocks());

describe('fetchForeverRulesetRaw — 200 (ROK-2100)', () => {
  it('returns the raw ruleset object from the realmless Forever profile', async () => {
    const spy = mockResponse(200, { name: 'Ana', ruleset: { type: 'RP_PVP' } });
    await expect(call()).resolves.toEqual({
      kind: 'found',
      ruleset: { type: 'RP_PVP' },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/us\.api\.blizzard\.com\/profile\/wow\/character\/.+namespace=profile-/,
      ),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('a body with no ruleset → found with a null ruleset', async () => {
    mockResponse(200, { name: 'Ana' });
    await expect(call()).resolves.toEqual({ kind: 'found', ruleset: null });
  });

  it('a non-object body → found with a null ruleset', async () => {
    mockResponse(200, 'plain');
    await expect(call()).resolves.toEqual({ kind: 'found', ruleset: null });
  });
});

describe('fetchForeverRulesetRaw — non-200 (ROK-2100)', () => {
  it.each([404, 403])('%i → absent, logged at debug only', async (status) => {
    mockResponse(status);
    const log = logger();
    await expect(call(log)).resolves.toEqual({ kind: 'absent' });
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([500, 503])('%i → error with a warn', async (status) => {
    mockResponse(status);
    const log = logger();
    await expect(call(log)).resolves.toEqual({ kind: 'error' });
    expect(log.warn).toHaveBeenCalledWith(
      `Forever ruleset lookup: profile API ${status}`,
    );
  });

  it('an aborted request (timeout) → error, never throws', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const log = logger();
    await expect(call(log)).resolves.toEqual({ kind: 'error' });
    expect(log.warn).toHaveBeenCalledWith(
      'Forever ruleset lookup failed: AbortError',
    );
  });

  it('a network failure → error, never throws', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    await expect(call()).resolves.toEqual({ kind: 'error' });
  });
});

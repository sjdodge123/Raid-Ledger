/**
 * Provider availability helpers (ROK-1148 item 2).
 *
 * These were private methods on AiProvidersController, reachable in a test
 * only by standing up the controller and its five injected services. Extracted,
 * they are pure functions over a probe callback — which is the whole reason the
 * item asked for the extraction, so the coverage lands with it.
 */
import {
  extractFriendlyError,
  checkAvailableWithError,
  resolveAvailability,
} from './ai-providers-availability.helper';

const FRESH = new Date(Date.now() - 60_000); // 1 min ago — inside the 5 min window
const STALE = new Date(Date.now() - 60 * 60_000); // 1 hour ago

function target(isAvailable: () => Promise<boolean>) {
  return { key: 'claude', isAvailable };
}

describe('extractFriendlyError', () => {
  it.each([
    ['credit balance is too low', 'Account has insufficient credits'],
    ['insufficient_quota for this org', 'Account has insufficient quota'],
    ['billing account suspended', 'Billing issue — check your account'],
    ['API_KEY_INVALID', 'Invalid API key'],
    ['authentication failed', 'Invalid API key'],
    ['403 PERMISSION_DENIED', 'API key lacks permissions'],
    ['429 too many requests', 'Rate limited — try again later'],
    ['socket hang up', 'Provider unreachable'],
  ])('maps %j to %j', (raw, friendly) => {
    expect(extractFriendlyError(raw)).toBe(friendly);
  });

  it('prefers the billing reading over the generic invalid match', () => {
    // Several providers put "invalid" in a message whose real cause is
    // billing; ordering in the helper is what keeps this accurate.
    expect(extractFriendlyError('invalid request: billing')).toBe(
      'Billing issue — check your account',
    );
  });
});

describe('checkAvailableWithError', () => {
  it('reports availability without an error on success', async () => {
    const result = await checkAvailableWithError(
      target(() => Promise.resolve(true)),
    );

    expect(result).toEqual({ available: true });
  });

  it('translates a thrown provider error', async () => {
    const result = await checkAvailableWithError(
      target(() => Promise.reject(new Error('429 rate limit'))),
    );

    expect(result).toEqual({
      available: false,
      error: 'Rate limited — try again later',
    });
  });

  it('treats a hanging probe as unavailable rather than hanging the request', async () => {
    jest.useFakeTimers();
    try {
      const pending = checkAvailableWithError(
        target(() => new Promise<boolean>(() => undefined)),
      );
      jest.advanceTimersByTime(2000);

      await expect(pending).resolves.toEqual({ available: false });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resolveAvailability', () => {
  it('probes a non-active provider even with a fresh heartbeat', async () => {
    const isAvailable = jest.fn().mockResolvedValue(true);
    const lastSuccess = jest.fn().mockResolvedValue(FRESH);

    const result = await resolveAvailability(
      target(isAvailable),
      false,
      lastSuccess,
    );

    expect(result).toEqual({ available: true });
    expect(isAvailable).toHaveBeenCalled();
    // The heartbeat shortcut is an active-provider optimisation only.
    expect(lastSuccess).not.toHaveBeenCalled();
  });

  it('skips the probe for an active provider with a recent success', async () => {
    const isAvailable = jest.fn().mockResolvedValue(false);

    const result = await resolveAvailability(target(isAvailable), true, () =>
      Promise.resolve(FRESH),
    );

    // ROK-1138: a logged success inside the freshness window beats a probe.
    expect(result).toEqual({ available: true });
    expect(isAvailable).not.toHaveBeenCalled();
  });

  it('falls back to the probe when the heartbeat is stale', async () => {
    const isAvailable = jest.fn().mockResolvedValue(true);

    const result = await resolveAvailability(target(isAvailable), true, () =>
      Promise.resolve(STALE),
    );

    expect(result).toEqual({ available: true });
    expect(isAvailable).toHaveBeenCalled();
  });

  it('surfaces the probe error when an active provider has never succeeded', async () => {
    const result = await resolveAvailability(
      target(() => Promise.reject(new Error('credit balance too low'))),
      true,
      () => Promise.resolve(null),
    );

    // The error detail only exists on the probe path — it must not be
    // swallowed by deriveAvailability's boolean return.
    expect(result).toEqual({
      available: false,
      error: 'Account has insufficient credits',
    });
  });
});

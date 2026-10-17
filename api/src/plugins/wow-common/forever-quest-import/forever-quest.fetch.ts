/**
 * ROK-1748: the live Wowhead page getter for the offline quest import —
 * bounded tries per URL, a hard request cap per run, and a rejected
 * `fetch()` (DNS / socket) treated like any other failed attempt so one
 * flaky page never aborts the whole import.
 */

export interface RetryingGetterOptions {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  /** Serialises + spaces requests (the ROK-1727 limiter's `schedule`). */
  schedule: <T>(task: () => Promise<T>) => Promise<T>;
  maxRequests: number;
  maxTries: number;
  userAgent: string;
}

/**
 * Build `get(url)`: body text on 2xx, null on 404 or after `maxTries`
 * failed attempts (non-2xx or rejected fetch); throws past `maxRequests`.
 */
export function createRetryingGetter(
  opts: RetryingGetterOptions,
): (url: string) => Promise<string | null> {
  let sent = 0;
  const attempt = (url: string): Promise<Response | null> =>
    opts
      .schedule(() =>
        opts.fetchFn(url, {
          headers: { 'User-Agent': opts.userAgent },
          redirect: 'follow',
        }),
      )
      .catch(() => null);
  return async (url) => {
    for (let tryN = 1; tryN <= opts.maxTries; tryN++) {
      if (++sent > opts.maxRequests)
        throw new Error(`request cap ${opts.maxRequests} reached`);
      const res = await attempt(url);
      if (res?.ok) return res.text();
      if (res?.status === 404) return null;
    }
    return null;
  };
}

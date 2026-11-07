/**
 * ROK-2129 F1 — the pure run/parity layer with a fake fetch: slugs are
 * percent-encoded exactly once (MINOR-1 / Codex P2), and the run budget stops
 * further Blizzard calls and records a partial result (MINOR-2 / Codex P2).
 */
import type { BnetFetch } from './bnet-account-probe.oauth';
import {
  realmlessSlugFromHref,
  runIdParity,
  type ParityContext,
} from './bnet-account-probe.parity';
import { runBnetProbe, type BnetProbeRunDeps } from './bnet-account-probe.run';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const budgetSpent = (): DOMException =>
  new DOMException('run budget spent', 'TimeoutError');

function ctx(
  signal: AbortSignal = new AbortController().signal,
): ParityContext {
  return { region: 'us', prefix: 'forever', appToken: 'app', signal };
}

/** A summary body whose characters carry the given hrefs (ids 1..n). */
function bodyWith(chars: Array<{ href?: string; name?: string }>): unknown {
  const characters = chars.map((c, i) => ({
    ...(c.href === undefined ? {} : { character: { href: c.href } }),
    ...(c.name === undefined ? {} : { name: c.name }),
    id: i + 1,
  }));
  return { wow_accounts: [{ id: 1, characters }] };
}

describe('parity slugs are percent-encoded exactly once', () => {
  it('an escaped href slug is decoded before lookup', async () => {
    const urls: string[] = [];
    const fetchFn: BnetFetch = (url) => {
      urls.push(url);
      return Promise.resolve(json({ id: 1 }));
    };
    const href =
      'https://us.api.blizzard.com/profile/wow/character/%C3%A9lodie-forever?namespace=profile-forever-us';
    const out = await runIdParity(fetchFn, bodyWith([{ href }]), ctx());
    expect(urls[0]).toContain('/profile/wow/character/%C3%A9lodie-forever?');
    expect(urls[0]).not.toContain('%25');
    expect(out).toMatchObject({ checked: 1, matched: 1, viaHref: 1 });
  });

  it('a non-ASCII name (no href) is encoded once', async () => {
    const urls: string[] = [];
    const fetchFn: BnetFetch = (url) => {
      urls.push(url);
      return Promise.resolve(json({ id: 1 }));
    };
    await runIdParity(fetchFn, bodyWith([{ name: 'Élodie Forever' }]), ctx());
    expect(urls[0]).toContain('/profile/wow/character/%C3%A9lodie-forever?');
    expect(urls[0]).not.toContain('%25');
  });

  it('a malformed escape or an encoded slash yields no slug', () => {
    const base = 'https://us.api.blizzard.com/profile/wow/character/';
    expect(realmlessSlugFromHref(`${base}%E0%A4%A`)).toBeNull();
    expect(realmlessSlugFromHref(`${base}realm%2Fname`)).toBeNull();
  });
});

describe('the run budget (callback must 302 inside nginx 60s)', () => {
  it('parity stops calling once the signal aborts; the rest count as errors', async () => {
    const budget = new AbortController();
    let calls = 0;
    const fetchFn: BnetFetch = () => {
      calls += 1;
      if (calls === 2) budget.abort(budgetSpent());
      return Promise.resolve(json({ id: calls }));
    };
    const hrefs = [1, 2, 3, 4, 5].map((i) => ({
      href: `https://us.api.blizzard.com/profile/wow/character/hero${i}-forever`,
    }));
    const out = await runIdParity(fetchFn, bodyWith(hrefs), ctx(budget.signal));
    expect(calls).toBe(2);
    expect(out).toMatchObject({ checked: 5, matched: 2, errors: 3 });
  });

  it('a spent budget skips the remaining namespaces and the app token, aborting in-flight calls', async () => {
    const budget = new AbortController();
    const seen: string[] = [];
    const captured: { signal: AbortSignal | null } = { signal: null };
    const fetchFn: BnetFetch = (url, init) => {
      seen.push(url);
      if (url.startsWith('https://oauth.battle.net/token')) {
        return Promise.resolve(json({ access_token: 'AT', expires_in: 1 }));
      }
      captured.signal = init.signal ?? null;
      budget.abort(budgetSpent());
      return Promise.resolve(
        json(bodyWith([{ name: 'Hero One' }, { name: 'Hero Two' }])),
      );
    };
    const getAppToken = jest.fn().mockResolvedValue('app');
    const deps: BnetProbeRunDeps = {
      fetchFn,
      getAppToken,
      foreverPrefix: 'forever',
      signal: budget.signal,
    };
    const result = await runBnetProbe(deps, {
      at: '2026-11-07T00:00:00.000Z',
      region: 'us',
      code: 'c',
      codeVerifier: 'v',
      redirectUri: 'https://x.test/cb',
      clientId: 'cid',
      clientSecret: 'cs',
    });
    expect(seen).toHaveLength(2);
    expect(captured.signal?.aborted).toBe(true);
    expect(result.namespaces.slice(1)).toEqual([
      expect.objectContaining({ status: null, error: 'timeout' }),
      expect.objectContaining({ status: null, error: 'timeout' }),
      expect.objectContaining({ status: null, error: 'timeout' }),
    ]);
    expect(getAppToken).not.toHaveBeenCalled();
    expect(result.idParity).toMatchObject({ checked: 2, errors: 2 });
  });
});

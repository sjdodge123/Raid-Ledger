/**
 * ROK-2129 F1 (Codex P2) — the registered callback URL resolves to a base the
 * api actually answers on: behind nginx `${CLIENT_URL}/api/...`; in the split
 * dev env (web :5173, api :3000, no `/api` proxy) the api's own origin.
 */
import { buildBnetProbeRedirectUri } from './bnet-account-probe.oauth';

const NEST = '/plugins/blizzard/bnet-account-probe/callback';

describe('buildBnetProbeRedirectUri', () => {
  it('split dev env: the api base comes from the Discord callback env', () => {
    expect(
      buildBnetProbeRedirectUri(
        'http://localhost:5173',
        'http://localhost:3000/auth/discord/callback',
      ),
    ).toBe(`http://localhost:3000${NEST}`);
  });

  it('a public client URL keeps the /api path behind nginx', () => {
    expect(
      buildBnetProbeRedirectUri(
        'https://slot-1.gamernight.net/',
        'http://localhost:3000/auth/discord/callback',
      ),
    ).toBe(`https://slot-1.gamernight.net/api${NEST}`);
  });

  it('loopback client without a usable Discord callback falls back to /api', () => {
    for (const discord of [
      undefined,
      '',
      'not a url',
      'http://localhost:3000/somewhere/else',
      'javascript:alert(1)//auth/discord/callback',
    ]) {
      expect(buildBnetProbeRedirectUri('http://localhost:5173', discord)).toBe(
        `http://localhost:5173/api${NEST}`,
      );
    }
  });

  it('a Discord callback behind an /api prefix keeps that prefix', () => {
    expect(
      buildBnetProbeRedirectUri(
        'http://127.0.0.1:8080',
        'http://127.0.0.1:8080/api/auth/discord/callback',
      ),
    ).toBe(`http://127.0.0.1:8080/api${NEST}`);
  });
});

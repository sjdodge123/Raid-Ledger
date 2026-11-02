/**
 * Tech debt 2026-10-30 (ROK-1697): the socket.io namespaces decide the CORS
 * origin at handshake time from the HTTP policy's env (`CORS_ORIGIN`), never
 * from a module-load `CLIENT_URL || '*'`. `auto` reads the Host header like
 * HTTP does (Codex P2, fix-batch 2026-11-02).
 */
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { AdHocEventsGateway } from '../events/ad-hoc-events.gateway';
import { LineupsGateway } from '../lineups/lineups.gateway';
import { socketCorsDelegate, socketOriginAllowed } from './socket-cors';

const SITE = 'https://raid.example.com';
const EVIL = 'https://evil.example.net';

describe('socketOriginAllowed', () => {
  it('no Origin (server-side client) is allowed', () => {
    expect(socketOriginAllowed(undefined, {}, true)).toBe(true);
  });

  it('CORS_ORIGIN unset never falls back to any origin', () => {
    expect(socketOriginAllowed(EVIL, {}, true)).toBe(false);
    expect(socketOriginAllowed(EVIL, { clientUrl: '' }, false)).toBe(false);
  });

  it('an explicit CORS_ORIGIN allows only itself', () => {
    expect(socketOriginAllowed(SITE, { corsOrigin: SITE }, true)).toBe(true);
    expect(socketOriginAllowed(EVIL, { corsOrigin: SITE }, true)).toBe(false);
  });

  it('auto (same-origin only) grants no cross-origin access', () => {
    const env = { corsOrigin: 'auto' };
    expect(socketOriginAllowed(EVIL, env, true)).toBe(false);
    expect(socketOriginAllowed(EVIL, env, true, 'raid.example.com')).toBe(
      false,
    );
  });

  it('auto allows the same hostname on another port, like HTTP auto', () => {
    const env = { corsOrigin: 'auto' };
    const origin = 'http://raid.example.com:8080';
    expect(socketOriginAllowed(origin, env, true, 'raid.example.com:3000')).toBe(
      true,
    );
    expect(socketOriginAllowed(SITE, env, true, 'raid.example.com')).toBe(true);
  });

  it('an explicit CORS_ORIGIN ignores the Host header', () => {
    const env = { corsOrigin: SITE };
    expect(socketOriginAllowed(EVIL, env, true, 'evil.example.net')).toBe(
      false,
    );
  });

  it('auto in report mode mirrors the HTTP rollback (allows)', () => {
    const env = { corsOrigin: 'auto', autoMode: 'report' };
    expect(socketOriginAllowed(EVIL, env, true)).toBe(true);
  });

  it('dev localhost is allowed outside production only', () => {
    const dev = 'http://localhost:5173';
    expect(socketOriginAllowed(dev, {}, false)).toBe(true);
    expect(socketOriginAllowed(dev, {}, true)).toBe(false);
  });
});

/** Put one env key back as it was (deleting it when it was unset). */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('socketCorsDelegate', () => {
  const savedOrigin = process.env.CORS_ORIGIN;
  const savedMode = process.env.CORS_AUTO_MODE;
  afterEach(() => {
    restoreEnv('CORS_ORIGIN', savedOrigin);
    restoreEnv('CORS_AUTO_MODE', savedMode);
  });

  /** The `origin` grant the delegate answers for one request. */
  function grant(origin: string, host?: string): unknown {
    const answers: unknown[] = [];
    const headers = host === undefined ? { origin } : { origin, host };
    socketCorsDelegate({ headers }, (_err, options) =>
      answers.push(options?.origin),
    );
    return answers[0];
  }

  it('reads CORS_ORIGIN at handshake time, not at module load', () => {
    process.env.CORS_ORIGIN = SITE;
    const first = grant(EVIL);
    process.env.CORS_ORIGIN = EVIL;
    expect([first, grant(EVIL)]).toEqual([false, true]);
  });

  it('auto decides from the request Host header', () => {
    process.env.CORS_ORIGIN = 'auto';
    process.env.CORS_AUTO_MODE = 'enforce';
    const origin = 'http://raid.example.com:8080';
    expect(grant(origin, 'raid.example.com:3000')).toBe(true);
    expect(grant(EVIL, 'raid.example.com:3000')).toBe(false);
    expect(grant(origin)).toBe(false);
  });

  it.each([
    ['LineupsGateway', LineupsGateway],
    ['AdHocEventsGateway', AdHocEventsGateway],
  ])('%s leaves CORS to SocketCorsIoAdapter (no per-gateway cors)', (_n, gw) => {
    const opts = Reflect.getMetadata(GATEWAY_OPTIONS, gw) as {
      cors?: unknown;
    };
    expect(opts.cors).toBeUndefined();
  });
});

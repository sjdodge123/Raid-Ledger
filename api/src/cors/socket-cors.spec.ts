/**
 * Tech debt 2026-10-30 (ROK-1697): the socket.io namespaces decide the CORS
 * origin at handshake time from the HTTP policy's env (`CORS_ORIGIN`), never
 * from a module-load `CLIENT_URL || '*'`.
 */
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { AdHocEventsGateway } from '../events/ad-hoc-events.gateway';
import { LineupsGateway } from '../lineups/lineups.gateway';
import { socketCorsOrigin, socketOriginAllowed } from './socket-cors';

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

describe('socketCorsOrigin', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads CORS_ORIGIN at handshake time, not at module load', () => {
    const answers: unknown[] = [];
    process.env.CORS_ORIGIN = SITE;
    socketCorsOrigin(EVIL, (_err, allow) => answers.push(allow));
    process.env.CORS_ORIGIN = EVIL;
    socketCorsOrigin(EVIL, (_err, allow) => answers.push(allow));
    expect(answers).toEqual([false, true]);
  });

  it.each([
    ['LineupsGateway', LineupsGateway],
    ['AdHocEventsGateway', AdHocEventsGateway],
  ])('%s uses the handshake-time origin decision', (_name, gateway) => {
    const opts = Reflect.getMetadata(GATEWAY_OPTIONS, gateway) as {
      cors?: { origin?: unknown; credentials?: boolean };
    };
    expect(opts.cors).toEqual({ origin: socketCorsOrigin, credentials: true });
  });
});

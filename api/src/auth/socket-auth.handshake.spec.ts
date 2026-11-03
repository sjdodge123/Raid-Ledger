/**
 * Review MINOR-3 (tech-debt 2026-11-03): a REAL Socket.IO server + client —
 * Nest hands each gateway's `afterInit` its namespace, and the `server.use`
 * middleware registered there gates that namespace's handshake. Session
 * validation runs against a stubbed db (no Postgres), as the gateway specs do.
 */
import type { AddressInfo } from 'net';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io } from 'socket.io-client';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { AdHocEventsGateway } from '../events/ad-hoc-events.gateway';
import { LineupsGateway } from '../lineups/lineups.gateway';
import {
  ACTIVE_AUTH_ROW,
  mockAuthDb,
} from '../common/testing/socket-auth-fixtures';
import { clearAuthUserCache } from './auth-user-cache';

const jwt = new JwtService({ secret: 'socket-handshake-spec-secret' });
const NAMESPACES = ['/ad-hoc', '/lineups'];

let app: INestApplication;
let baseUrl = '';

type Outcome = { connected: true } | { connected: false; message: string };

/** Open one real client on `namespace`; resolve with how its handshake ended. */
function handshake(
  namespace: string,
  auth: Record<string, unknown>,
): Promise<Outcome> {
  const client = io(`${baseUrl}${namespace}`, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  return new Promise<Outcome>((resolve) => {
    client.once('connect', () => resolve({ connected: true }));
    client.once('connect_error', (err) =>
      resolve({ connected: false, message: err.message }),
    );
  }).finally(() => client.close());
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AdHocEventsGateway,
      LineupsGateway,
      { provide: JwtService, useValue: jwt },
      {
        provide: DrizzleAsyncProvider,
        useValue: mockAuthDb([ACTIVE_AUTH_ROW]),
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as { address(): AddressInfo };
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => app.close());
beforeEach(() => clearAuthUserCache());

describe.each(NAMESPACES)('real socket.io handshake on %s', (namespace) => {
  it('admits a valid session token', async () => {
    const token = jwt.sign({ sub: 1, username: 'u', tv: 0 });
    await expect(handshake(namespace, { token })).resolves.toEqual({
      connected: true,
    });
  });

  it('refuses a handshake with no token before it connects', async () => {
    await expect(handshake(namespace, {})).resolves.toEqual({
      connected: false,
      message: 'unauthorized',
    });
  });

  it('refuses a token signed with another secret', async () => {
    const forged = new JwtService({ secret: 'not-the-secret' });
    const token = forged.sign({ sub: 1, username: 'u', tv: 0 });
    await expect(handshake(namespace, { token })).resolves.toEqual({
      connected: false,
      message: 'unauthorized',
    });
  });
});

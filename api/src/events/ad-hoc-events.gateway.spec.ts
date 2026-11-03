import { AdHocEventsGateway } from './ad-hoc-events.gateway';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { signPurposeJwt } from '../auth/purpose-jwt.helpers';
import { clearAuthUserCache } from '../auth/auth-user-cache';
import {
  ACTIVE_AUTH_ROW,
  describeSocketSessionChecks,
  mockAuthDb,
  runSocketAuth,
} from '../common/testing/socket-auth-fixtures';

let gateway: AdHocEventsGateway;
let mockServer: { to: jest.Mock };
let mockEmit: jest.Mock;
let mockJwtService: { verify: jest.Mock };

function setupEach() {
  mockEmit = jest.fn();
  mockServer = {
    to: jest.fn().mockReturnValue({ emit: mockEmit }),
  };
  mockJwtService = {
    verify: jest.fn().mockReturnValue({ sub: 1, username: 'test', tv: 0 }),
  };

  clearAuthUserCache();
  gateway = new AdHocEventsGateway(
    mockJwtService as unknown as JwtService,
    mockAuthDb([ACTIVE_AUTH_ROW]),
  );
  (gateway as unknown as { server: typeof mockServer }).server = mockServer;
}

function makeClient(
  id: string,
  overrides: Record<string, unknown> = {},
): Socket {
  return {
    id,
    handshake: { auth: { token: 'valid-jwt-token' } },
    disconnect: jest.fn(),
    ...overrides,
  } as unknown as Socket;
}

async function testAcceptsValidToken() {
  const client = makeClient('client-1');
  await expect(runSocketAuth(gateway, client)).resolves.toBeUndefined();
  expect(mockJwtService.verify).toHaveBeenCalledWith('valid-jwt-token');
}

/** The handshake middleware called `next(err)`: the socket never connected. */
async function expectRefused(client: Socket): Promise<void> {
  const err = await runSocketAuth(gateway, client);
  expect(err).toBeInstanceOf(Error);
  expect(err?.message).toBe('unauthorized');
  expect(client.disconnect).not.toHaveBeenCalled();
}

async function testDisconnectsWithoutToken() {
  const client = makeClient('client-2', { handshake: { auth: {} } });
  await expectRefused(client);
}

async function testDisconnectsWithInvalidToken() {
  mockJwtService.verify.mockImplementationOnce(() => {
    throw new Error('invalid token');
  });
  const client = makeClient('client-3', {
    handshake: { auth: { token: 'bad-token' } },
  });
  await expectRefused(client);
}

async function testDisconnectsWithMissingAuthObject() {
  const client = makeClient('client-4', { handshake: {} });
  await expectRefused(client);
}

function testHandleDisconnect() {
  const client = { id: 'client-4' } as unknown as Socket;
  gateway.handleDisconnect(client);
}

function testHandleSubscribe() {
  const mockJoin = jest.fn().mockResolvedValue(undefined);
  const client = { id: 'client-5', join: mockJoin } as unknown as Socket;
  gateway.handleSubscribe(client, { eventId: 42 });
  expect(mockJoin).toHaveBeenCalledWith('event:42');
}

function testHandleUnsubscribe() {
  const mockLeave = jest.fn().mockResolvedValue(undefined);
  const client = { id: 'client-6', leave: mockLeave } as unknown as Socket;
  gateway.handleUnsubscribe(client, { eventId: 42 });
  expect(mockLeave).toHaveBeenCalledWith('event:42');
}

function testEmitRosterUpdate() {
  const participants = [
    {
      id: 'uuid-1',
      eventId: 42,
      userId: 1,
      discordUserId: 'discord-1',
      discordUsername: 'Player1',
      discordAvatarHash: null,
      joinedAt: '2026-02-10T18:00:00Z',
      leftAt: null,
      totalDurationSeconds: null,
      sessionCount: 1,
    },
  ];
  gateway.emitRosterUpdate(42, participants, 1);
  expect(mockServer.to).toHaveBeenCalledWith('event:42');
  expect(mockEmit).toHaveBeenCalledWith('roster:update', {
    eventId: 42,
    participants,
    activeCount: 1,
  });
}

function testEmitRosterUpdateEmpty() {
  gateway.emitRosterUpdate(42, [], 0);
  expect(mockEmit).toHaveBeenCalledWith('roster:update', {
    eventId: 42,
    participants: [],
    activeCount: 0,
  });
}

function testEmitLiveStatus() {
  gateway.emitStatusChange(42, 'live');
  expect(mockServer.to).toHaveBeenCalledWith('event:42');
  expect(mockEmit).toHaveBeenCalledWith('event:status', {
    eventId: 42,
    status: 'live',
  });
}

function testEmitGracePeriodStatus() {
  gateway.emitStatusChange(42, 'grace_period');
  expect(mockEmit).toHaveBeenCalledWith('event:status', {
    eventId: 42,
    status: 'grace_period',
  });
}

function testEmitEndedStatus() {
  gateway.emitStatusChange(42, 'ended');
  expect(mockEmit).toHaveBeenCalledWith('event:status', {
    eventId: 42,
    status: 'ended',
  });
}

function testEmitEndTimeExtended() {
  gateway.emitEndTimeExtended(42, '2026-02-10T21:00:00Z');
  expect(mockServer.to).toHaveBeenCalledWith('event:42');
  expect(mockEmit).toHaveBeenCalledWith('event:endTimeExtended', {
    eventId: 42,
    newEndTime: '2026-02-10T21:00:00Z',
  });
}

beforeEach(() => setupEach());

describe('AdHocEventsGateway — connection', () => {
  it('accepts connection with valid auth token', () => testAcceptsValidToken());
  it('refuses (next(err)) a client without auth token before it connects', () =>
    testDisconnectsWithoutToken());
  it('refuses (next(err)) a client with invalid auth token before it connects', () =>
    testDisconnectsWithInvalidToken());
  it('refuses (next(err)) a client with missing auth object before it connects', () =>
    testDisconnectsWithMissingAuthObject());
  it('handles client disconnect', () => testHandleDisconnect());
  it('joins the correct room for event', () => testHandleSubscribe());
  it('leaves the correct room for event', () => testHandleUnsubscribe());
});

describe('AdHocEventsGateway — emit', () => {
  it('emits roster update to the correct room', () => testEmitRosterUpdate());
  it('emits with empty participants array', () => testEmitRosterUpdateEmpty());
  it('emits live status', () => testEmitLiveStatus());
  it('emits grace_period status', () => testEmitGracePeriodStatus());
  it('emits ended status', () => testEmitEndedStatus());
  it('emits end time extension', () => testEmitEndTimeExtended());
});

// ── ROK-1366 AC5 — a magic-link token never opens a socket ──────────────────
// Real JwtService (not the mock): the gateway verifies with JWT_SECRET, and a
// magic token is signed with the derived 'magic-link' purpose secret (D1).

const MAGIC_SPEC_SECRET = 'gateway-magic-spec-secret';
let savedJwtSecret: string | undefined;

async function handshakeWith(token: string): Promise<Error | undefined> {
  const realJwt = new JwtService({ secret: MAGIC_SPEC_SECRET });
  const realGateway = new AdHocEventsGateway(
    realJwt,
    mockAuthDb([ACTIVE_AUTH_ROW]),
  );
  const client = makeClient('client-magic', { handshake: { auth: { token } } });
  return runSocketAuth(realGateway, client);
}

describe('AdHocEventsGateway — magic-link handshake (ROK-1366 AC5)', () => {
  beforeAll(() => {
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = MAGIC_SPEC_SECRET;
  });
  afterAll(() => {
    process.env.JWT_SECRET = savedJwtSecret;
  });

  it('accepts a session token signed with JWT_SECRET (control)', async () => {
    const signer = new JwtService({ secret: MAGIC_SPEC_SECRET });
    const err = await handshakeWith(
      signer.sign({ sub: 1, username: 'test', tv: 0 }),
    );
    expect(err).toBeUndefined();
  });

  it('refuses a magic-link token signed with the purpose secret', async () => {
    const magic = signPurposeJwt(
      new JwtService(),
      'magic-link',
      { sub: 1, magicLink: true },
      '15m',
    );
    const err = await handshakeWith(magic);
    expect(err?.message).toBe('unauthorized');
  });

  it('refuses a legacy magic-link token signed with JWT_SECRET', async () => {
    // Links minted before the purpose-secret switch were signed with
    // JWT_SECRET; the secret alone cannot reject them (mirrors JwtStrategy).
    const signer = new JwtService({ secret: MAGIC_SPEC_SECRET });
    const legacy = signer.sign({ sub: 1, username: 'test', magicLink: true });
    const err = await handshakeWith(legacy);
    expect(err?.message).toBe('unauthorized');
  });
});

describeSocketSessionChecks(
  'AdHocEventsGateway',
  (jwt, db) => new AdHocEventsGateway(jwt, db),
);

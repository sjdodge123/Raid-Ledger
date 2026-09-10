import { LineupsGateway } from './lineups.gateway';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

let gateway: LineupsGateway;
let mockServer: { to: jest.Mock };
let mockEmit: jest.Mock;
let mockJwtService: { verify: jest.Mock };

function setupEach() {
  mockEmit = jest.fn();
  mockServer = {
    to: jest.fn().mockReturnValue({ emit: mockEmit }),
  };
  mockJwtService = {
    verify: jest.fn().mockReturnValue({ sub: 1, username: 'test' }),
  };

  gateway = new LineupsGateway(mockJwtService as unknown as JwtService);
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

function testAcceptsValidToken() {
  const client = makeClient('client-1');
  gateway.handleConnection(client);
  expect(mockJwtService.verify).toHaveBeenCalledWith('valid-jwt-token');
  expect(client.disconnect).not.toHaveBeenCalled();
}

function testDisconnectsWithoutToken() {
  const client = makeClient('client-2', { handshake: { auth: {} } });
  gateway.handleConnection(client);
  expect(client.disconnect).toHaveBeenCalledWith(true);
}

function testDisconnectsWithInvalidToken() {
  mockJwtService.verify.mockImplementationOnce(() => {
    throw new Error('invalid token');
  });
  const client = makeClient('client-3', {
    handshake: { auth: { token: 'bad-token' } },
  });
  gateway.handleConnection(client);
  expect(client.disconnect).toHaveBeenCalledWith(true);
}

function testDisconnectsWithMissingAuthObject() {
  const client = makeClient('client-4', { handshake: {} });
  gateway.handleConnection(client);
  expect(client.disconnect).toHaveBeenCalledWith(true);
}

function testHandleDisconnect() {
  const client = { id: 'client-x' } as unknown as Socket;
  gateway.handleDisconnect(client);
}

function testHandleSubscribe() {
  const mockJoin = jest.fn().mockResolvedValue(undefined);
  const client = { id: 'client-5', join: mockJoin } as unknown as Socket;
  gateway.handleSubscribe(client, { lineupId: 42 });
  expect(mockJoin).toHaveBeenCalledWith('lineup:42');
}

function testHandleUnsubscribe() {
  const mockLeave = jest.fn().mockResolvedValue(undefined);
  const client = { id: 'client-6', leave: mockLeave } as unknown as Socket;
  gateway.handleUnsubscribe(client, { lineupId: 42 });
  expect(mockLeave).toHaveBeenCalledWith('lineup:42');
}

function testEmitStatusChangeBuilding() {
  const ts = new Date('2026-04-27T12:00:00.000Z');
  gateway.emitStatusChange(42, 'building', ts);
  expect(mockServer.to).toHaveBeenCalledWith('lineup:42');
  expect(mockEmit).toHaveBeenCalledWith('lineup:status', {
    lineupId: 42,
    status: 'building',
    statusChangedAt: '2026-04-27T12:00:00.000Z',
  });
}

function testEmitStatusChangeVoting() {
  const ts = new Date('2026-04-27T13:00:00.000Z');
  gateway.emitStatusChange(7, 'voting', ts);
  expect(mockServer.to).toHaveBeenCalledWith('lineup:7');
  expect(mockEmit).toHaveBeenCalledWith('lineup:status', {
    lineupId: 7,
    status: 'voting',
    statusChangedAt: '2026-04-27T13:00:00.000Z',
  });
}

function testEmitStatusChangeDecided() {
  const ts = new Date('2026-04-27T14:00:00.000Z');
  gateway.emitStatusChange(99, 'decided', ts);
  expect(mockEmit).toHaveBeenCalledWith('lineup:status', {
    lineupId: 99,
    status: 'decided',
    statusChangedAt: '2026-04-27T14:00:00.000Z',
  });
}

function testEmitStatusChangeRejectsUnknownStatus() {
  expect(() =>
    gateway.emitStatusChange(
      1,
      'bogus' as unknown as 'building',
      new Date('2026-04-27T15:00:00.000Z'),
    ),
  ).toThrow();
  expect(mockEmit).not.toHaveBeenCalled();
}

// ─── ROK-1117: tiebreaker-open event ─────────────────────────────────────
//
// `emitTiebreakerOpen(lineupId, tiebreakerId, mode)` must validate its
// payload with a zod schema and broadcast `lineup:tiebreaker:open` to
// the room `lineup:<id>`. These tests will fail until the dev agent
// adds the method on the gateway and the contract event name + schema.

type LineupsGatewayWithTiebreaker = LineupsGateway & {
  emitTiebreakerOpen: (
    lineupId: number,
    tiebreakerId: number,
    mode: 'bracket' | 'veto',
  ) => void;
};

function tbGateway(): LineupsGatewayWithTiebreaker {
  return gateway;
}

function testEmitTiebreakerOpenBracket() {
  tbGateway().emitTiebreakerOpen(42, 7, 'bracket');
  expect(mockServer.to).toHaveBeenCalledWith('lineup:42');
  expect(mockEmit).toHaveBeenCalledWith('lineup:tiebreaker:open', {
    lineupId: 42,
    tiebreakerId: 7,
    mode: 'bracket',
  });
}

function testEmitTiebreakerOpenVeto() {
  tbGateway().emitTiebreakerOpen(99, 13, 'veto');
  expect(mockServer.to).toHaveBeenCalledWith('lineup:99');
  expect(mockEmit).toHaveBeenCalledWith('lineup:tiebreaker:open', {
    lineupId: 99,
    tiebreakerId: 13,
    mode: 'veto',
  });
}

function testEmitTiebreakerOpenSerialisesRoundDeadline() {
  const deadline = new Date('2026-05-01T12:30:00.000Z');
  tbGateway().emitTiebreakerOpen(42, 7, 'bracket', deadline);
  expect(mockEmit).toHaveBeenCalledWith('lineup:tiebreaker:open', {
    lineupId: 42,
    tiebreakerId: 7,
    mode: 'bracket',
    // The wire contract is an ISO string, not a Date — clients parse it.
    roundDeadline: '2026-05-01T12:30:00.000Z',
  });
}

function testEmitTiebreakerOpenOmitsNullRoundDeadline() {
  tbGateway().emitTiebreakerOpen(42, 7, 'veto', null);
  expect(mockEmit).toHaveBeenCalledWith('lineup:tiebreaker:open', {
    lineupId: 42,
    tiebreakerId: 7,
    mode: 'veto',
  });
  // The key survives the schema parse but holds `undefined`, which
  // JSON.stringify drops — so nothing reaches the client. What matters is
  // that it is not coerced to `null`, which WOULD serialise and force every
  // consumer to distinguish "no deadline" from "deadline is null".
  const [, payload] = mockEmit.mock.calls[0] as [
    string,
    { roundDeadline?: string | null },
  ];
  expect(payload.roundDeadline).toBeUndefined();
  expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty(
    'roundDeadline',
  );
}

function testEmitTiebreakerOpenRejectsUnknownMode() {
  // Sanity: the method must exist before we assert on validation.
  expect(typeof tbGateway().emitTiebreakerOpen).toBe('function');
  expect(() =>
    tbGateway().emitTiebreakerOpen(1, 2, 'bogus' as unknown as 'bracket'),
  ).toThrow();
  expect(mockEmit).not.toHaveBeenCalled();
}

beforeEach(() => setupEach());

describe('LineupsGateway — connection', () => {
  it('accepts connection with valid auth token', () => testAcceptsValidToken());
  it('disconnects client without auth token', () =>
    testDisconnectsWithoutToken());
  it('disconnects client with invalid auth token', () =>
    testDisconnectsWithInvalidToken());
  it('disconnects client with missing auth object', () =>
    testDisconnectsWithMissingAuthObject());
  it('handles client disconnect', () => testHandleDisconnect());
  it('joins the correct room for lineup', () => testHandleSubscribe());
  it('leaves the correct room for lineup', () => testHandleUnsubscribe());
});

describe('LineupsGateway — emit', () => {
  it('emits building status to the correct room', () =>
    testEmitStatusChangeBuilding());
  it('emits voting status', () => testEmitStatusChangeVoting());
  it('emits decided status', () => testEmitStatusChangeDecided());
  it('rejects unknown status before emit', () =>
    testEmitStatusChangeRejectsUnknownStatus());
});

describe('LineupsGateway — emitTiebreakerOpen (ROK-1117)', () => {
  it('broadcasts bracket tiebreaker-open to the correct room', () =>
    testEmitTiebreakerOpenBracket());
  it('broadcasts veto tiebreaker-open to the correct room', () =>
    testEmitTiebreakerOpenVeto());
  it('serialises a roundDeadline Date to an ISO string', () =>
    testEmitTiebreakerOpenSerialisesRoundDeadline());
  it('omits roundDeadline entirely when passed null', () =>
    testEmitTiebreakerOpenOmitsNullRoundDeadline());
  it('rejects unknown mode before emit', () =>
    testEmitTiebreakerOpenRejectsUnknownMode());
});

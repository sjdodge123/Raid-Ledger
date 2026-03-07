import { AdHocEventsGateway } from './ad-hoc-events.gateway';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

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
    verify: jest.fn().mockReturnValue({ sub: 1, username: 'test' }),
  };

  gateway = new AdHocEventsGateway(mockJwtService as unknown as JwtService);
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
  it('disconnects client without auth token', () =>
    testDisconnectsWithoutToken());
  it('disconnects client with invalid auth token', () =>
    testDisconnectsWithInvalidToken());
  it('disconnects client with missing auth object', () =>
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

import { AdHocEventsGateway } from './ad-hoc-events.gateway';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';

describe('AdHocEventsGateway', () => {
  let gateway: AdHocEventsGateway;
  let mockServer: {
    to: jest.Mock;
  };
  let mockEmit: jest.Mock;

  let mockJwtService: { verify: jest.Mock };

  beforeEach(() => {
    mockEmit = jest.fn();
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: mockEmit }),
    };
    mockJwtService = {
      verify: jest.fn().mockReturnValue({ sub: 1, username: 'test' }),
    };

    gateway = new AdHocEventsGateway(mockJwtService as unknown as JwtService);
    // Assign mock server (normally injected by NestJS)
    (gateway as unknown as { server: typeof mockServer }).server = mockServer;
  });

  describe('handleConnection', () => {
    it('accepts connection with valid auth token', () => {
      const disconnectMock = jest.fn();
      const mockClient = {
        id: 'client-1',
        handshake: { auth: { token: 'valid-jwt-token' } },
        disconnect: disconnectMock,
      } as unknown as Socket;

      gateway.handleConnection(mockClient);

      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-jwt-token');
      expect(disconnectMock).not.toHaveBeenCalled();
    });

    it('disconnects client without auth token', () => {
      const disconnectMock = jest.fn();
      const mockClient = {
        id: 'client-2',
        handshake: { auth: {} },
        disconnect: disconnectMock,
      } as unknown as Socket;

      gateway.handleConnection(mockClient);

      expect(disconnectMock).toHaveBeenCalledWith(true);
    });

    it('disconnects client with invalid auth token', () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid token');
      });

      const disconnectMock = jest.fn();
      const mockClient = {
        id: 'client-3',
        handshake: { auth: { token: 'bad-token' } },
        disconnect: disconnectMock,
      } as unknown as Socket;

      gateway.handleConnection(mockClient);

      expect(disconnectMock).toHaveBeenCalledWith(true);
    });

    it('disconnects client with missing auth object', () => {
      const disconnectMock = jest.fn();
      const mockClient = {
        id: 'client-4',
        handshake: {},
        disconnect: disconnectMock,
      } as unknown as Socket;

      gateway.handleConnection(mockClient);

      expect(disconnectMock).toHaveBeenCalledWith(true);
    });
  });

  describe('handleDisconnect', () => {
    it('handles client disconnect', () => {
      const mockClient = {
        id: 'client-4',
      } as unknown as Socket;

      gateway.handleDisconnect(mockClient);
      // Just verify no error
    });
  });

  describe('handleSubscribe', () => {
    it('joins the correct room for event', () => {
      const mockJoin = jest.fn().mockResolvedValue(undefined);
      const mockClient = {
        id: 'client-5',
        join: mockJoin,
      } as unknown as Socket;

      gateway.handleSubscribe(mockClient, { eventId: 42 });

      expect(mockJoin).toHaveBeenCalledWith('event:42');
    });
  });

  describe('handleUnsubscribe', () => {
    it('leaves the correct room for event', () => {
      const mockLeave = jest.fn().mockResolvedValue(undefined);
      const mockClient = {
        id: 'client-6',
        leave: mockLeave,
      } as unknown as Socket;

      gateway.handleUnsubscribe(mockClient, { eventId: 42 });

      expect(mockLeave).toHaveBeenCalledWith('event:42');
    });
  });

  describe('emitRosterUpdate', () => {
    it('emits roster update to the correct room', () => {
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
    });

    it('emits with empty participants array', () => {
      gateway.emitRosterUpdate(42, [], 0);

      expect(mockEmit).toHaveBeenCalledWith('roster:update', {
        eventId: 42,
        participants: [],
        activeCount: 0,
      });
    });
  });

  describe('emitStatusChange', () => {
    it('emits live status', () => {
      gateway.emitStatusChange(42, 'live');

      expect(mockServer.to).toHaveBeenCalledWith('event:42');
      expect(mockEmit).toHaveBeenCalledWith('event:status', {
        eventId: 42,
        status: 'live',
      });
    });

    it('emits grace_period status', () => {
      gateway.emitStatusChange(42, 'grace_period');

      expect(mockEmit).toHaveBeenCalledWith('event:status', {
        eventId: 42,
        status: 'grace_period',
      });
    });

    it('emits ended status', () => {
      gateway.emitStatusChange(42, 'ended');

      expect(mockEmit).toHaveBeenCalledWith('event:status', {
        eventId: 42,
        status: 'ended',
      });
    });
  });

  describe('emitEndTimeExtended', () => {
    it('emits end time extension', () => {
      gateway.emitEndTimeExtended(42, '2026-02-10T21:00:00Z');

      expect(mockServer.to).toHaveBeenCalledWith('event:42');
      expect(mockEmit).toHaveBeenCalledWith('event:endTimeExtended', {
        eventId: 42,
        newEndTime: '2026-02-10T21:00:00Z',
      });
    });
  });
});

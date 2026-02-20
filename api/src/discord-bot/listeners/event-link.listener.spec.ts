import { EventLinkListener } from './event-link.listener';
import { ChannelType, Events, EmbedBuilder } from 'discord.js';

describe('EventLinkListener', () => {
  let listener: EventLinkListener;
  let mockClientService: Record<string, jest.Mock>;
  let mockEmbedFactory: Record<string, jest.Mock>;
  let mockSettingsService: Record<string, jest.Mock>;
  let mockEventsService: Record<string, jest.Mock>;
  let mockPugsService: Record<string, jest.Mock>;
  let mockDb: { insert: jest.Mock };

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = { toJSON: jest.fn() };

  let messageIdCounter = 0;

  beforeEach(() => {
    process.env.CLIENT_URL = 'http://localhost:5173';

    mockClientService = {
      getClient: jest.fn(),
    };

    mockEmbedFactory = {
      buildEventEmbed: jest.fn().mockReturnValue({
        embed: mockEmbed,
        row: mockRow,
      }),
    };

    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
    };

    mockEventsService = {
      findOne: jest.fn().mockResolvedValue({
        id: 42,
        title: 'Mythic Raid Night',
        startTime: '2026-02-20T20:00:00.000Z',
        endTime: '2026-02-20T23:00:00.000Z',
        signupCount: 15,
        cancelledAt: null,
        game: { name: 'World of Warcraft', coverUrl: null },
      }),
      buildEmbedEventData: jest.fn().mockResolvedValue({
        id: 42,
        title: 'Mythic Raid Night',
        startTime: '2026-02-20T20:00:00.000Z',
        endTime: '2026-02-20T23:00:00.000Z',
        signupCount: 15,
        maxAttendees: null,
        slotConfig: null,
        roleCounts: {},
        signupMentions: [],
        game: { name: 'World of Warcraft', coverUrl: null },
      }),
    };

    mockPugsService = {
      findByInviteCode: jest.fn().mockResolvedValue(null),
    };

    const insertChain: Record<string, jest.Mock> = {};
    insertChain.values = jest.fn().mockReturnValue(insertChain);
    insertChain.onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    mockDb = {
      insert: jest.fn().mockReturnValue(insertChain),
    };

    listener = new EventLinkListener(
      mockDb as never,
      mockClientService as never,
      mockEmbedFactory as never,
      mockSettingsService as never,
      mockEventsService as never,
      mockPugsService as never,
    );
  });

  afterEach(() => {
    delete process.env.CLIENT_URL;
  });

  // Access the private handleMessage method for direct testing
  function callHandleMessage(message: unknown): Promise<void> {
    return (
      listener as unknown as { handleMessage: (m: unknown) => Promise<void> }
    ).handleMessage(message);
  }

  describe('handleBotConnected', () => {
    it('should register a messageCreate listener on the client', () => {
      const mockOn = jest.fn();
      mockClientService.getClient.mockReturnValue({ on: mockOn });

      listener.handleBotConnected();

      expect(mockOn).toHaveBeenCalledWith(
        Events.MessageCreate,
        expect.any(Function),
      );
    });

    it('should not register twice', () => {
      const mockOn = jest.fn();
      mockClientService.getClient.mockReturnValue({ on: mockOn });

      listener.handleBotConnected();
      listener.handleBotConnected();

      expect(mockOn).toHaveBeenCalledTimes(1);
    });

    it('should skip if no client', () => {
      mockClientService.getClient.mockReturnValue(null);
      // Should not throw
      listener.handleBotConnected();
    });
  });

  describe('handleBotDisconnected', () => {
    it('should reset listener state so it can re-attach', () => {
      const mockOn = jest.fn();
      mockClientService.getClient.mockReturnValue({ on: mockOn });

      listener.handleBotConnected();
      listener.handleBotDisconnected();
      listener.handleBotConnected();

      expect(mockOn).toHaveBeenCalledTimes(2);
    });
  });

  describe('message handling', () => {
    let mockReply: jest.Mock;

    beforeEach(() => {
      mockReply = jest.fn().mockResolvedValue({ id: 'reply-msg-1' });
    });

    function createMessage(
      content: string,
      overrides: Record<string, unknown> = {},
    ) {
      messageIdCounter++;
      return {
        id: `msg-${messageIdCounter}`,
        content,
        author: { bot: false },
        guild: { id: '123' },
        channel: { type: ChannelType.GuildText, id: 'chan-1' },
        reply: mockReply,
        ...overrides,
      };
    }

    it('should unfurl a single event link', async () => {
      const msg = createMessage('Check out http://localhost:5173/events/42');

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
      expect(mockEmbedFactory.buildEventEmbed).toHaveBeenCalled();
      expect(mockReply).toHaveBeenCalledWith({
        embeds: [mockEmbed],
        components: [mockRow],
      });
    });

    it('should batch multiple event links into a single reply', async () => {
      const msg = createMessage(
        'Events: http://localhost:5173/events/1 and http://localhost:5173/events/2 and http://localhost:5173/events/3 and http://localhost:5173/events/4',
      );

      await callHandleMessage(msg);

      // Should only unfurl up to 3
      expect(mockEventsService.findOne).toHaveBeenCalledTimes(3);
      // All embeds sent in a single reply
      expect(mockReply).toHaveBeenCalledTimes(1);
      expect(mockReply).toHaveBeenCalledWith({
        embeds: [mockEmbed, mockEmbed, mockEmbed],
        components: [mockRow, mockRow, mockRow],
      });
    });

    it('should deduplicate the same event ID', async () => {
      const msg = createMessage(
        'http://localhost:5173/events/42 and http://localhost:5173/events/42',
      );

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).toHaveBeenCalledTimes(1);
      expect(mockReply).toHaveBeenCalledTimes(1);
    });

    it('should skip messages from bots', async () => {
      const msg = createMessage('http://localhost:5173/events/42', {
        author: { bot: true },
      });

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).not.toHaveBeenCalled();
    });

    it('should skip DM messages (no guild)', async () => {
      const msg = createMessage('http://localhost:5173/events/42', {
        guild: null,
      });

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).not.toHaveBeenCalled();
    });

    it('should skip non-text channels', async () => {
      const msg = createMessage('http://localhost:5173/events/42', {
        channel: { type: ChannelType.GuildVoice },
      });

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).not.toHaveBeenCalled();
    });

    it('should skip if CLIENT_URL is not set', async () => {
      delete process.env.CLIENT_URL;
      const msg = createMessage('http://localhost:5173/events/42');

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).not.toHaveBeenCalled();
    });

    it('should skip messages with no event links', async () => {
      const msg = createMessage('Hello, just chatting!');

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).not.toHaveBeenCalled();
    });

    it('should silently ignore event IDs that do not exist', async () => {
      mockEventsService.findOne.mockRejectedValue(new Error('Event not found'));
      const msg = createMessage('http://localhost:5173/events/999');

      await callHandleMessage(msg);

      expect(mockReply).not.toHaveBeenCalled();
    });

    it('should skip cancelled events', async () => {
      mockEventsService.findOne.mockResolvedValue({
        id: 42,
        title: 'Cancelled Event',
        cancelledAt: '2026-02-20T00:00:00.000Z',
        startTime: '2026-02-20T20:00:00.000Z',
        endTime: '2026-02-20T23:00:00.000Z',
        signupCount: 0,
        game: null,
      });

      const msg = createMessage('http://localhost:5173/events/42');

      await callHandleMessage(msg);

      expect(mockReply).not.toHaveBeenCalled();
    });

    it('should work in announcement channels', async () => {
      const msg = createMessage('http://localhost:5173/events/42', {
        channel: { type: ChannelType.GuildAnnouncement },
      });

      await callHandleMessage(msg);

      expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
      expect(mockReply).toHaveBeenCalled();
    });

    it('should handle embed without row when no CLIENT_URL for preview', async () => {
      mockEmbedFactory.buildEventEmbed.mockReturnValue({
        embed: mockEmbed,
        row: undefined,
      });

      const msg = createMessage('http://localhost:5173/events/42');

      await callHandleMessage(msg);

      expect(mockReply).toHaveBeenCalledWith({
        embeds: [mockEmbed],
      });
    });

    it('should deduplicate the same message ID (HMR protection)', async () => {
      const msg = createMessage('http://localhost:5173/events/42');

      await callHandleMessage(msg);
      await callHandleMessage(msg);

      // Second call is a no-op — same message.id
      expect(mockEventsService.findOne).toHaveBeenCalledTimes(1);
      expect(mockReply).toHaveBeenCalledTimes(1);
    });
  });
});

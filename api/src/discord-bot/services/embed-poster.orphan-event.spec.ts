/**
 * ROK-1511: an event deleted while its embed is posting makes the
 * discord_event_messages insert raise FK 23503. The posted message must be
 * discarded (nothing can ever track it) and the job must complete.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EmbedPosterService } from './embed-poster.service';
import { isEventFkViolation } from './embed-poster.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from './discord-embed.factory';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

describe('EmbedPosterService — event deleted mid-post (ROK-1511)', () => {
  let service: EmbedPosterService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let mockDb: Record<string, jest.Mock>;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const mockMessage = { id: 'msg-123' };
  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  const baseEvent: EmbedEventData = {
    id: 42,
    title: 'Raid Night',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: 0,
  };

  /** postgres-js shape wrapped by DrizzleQueryError (drizzle >= 0.36). */
  const fkError = () =>
    Object.assign(
      new Error('Failed query: insert into "discord_event_messages" ...'),
      {
        cause: Object.assign(
          new Error(
            'insert or update on table "discord_event_messages" violates foreign key constraint "discord_event_messages_event_id_events_id_fk"',
          ),
          {
            code: '23503',
            constraint_name: 'discord_event_messages_event_id_events_id_fk',
            table_name: 'discord_event_messages',
          },
        ),
      },
    );

  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> & { then?: unknown } = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.innerJoin = jest.fn().mockReturnValue(chain);
    chain.groupBy = jest.fn().mockResolvedValue([]);
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  const rejectInsertWith = (err: unknown) => {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockRejectedValue(err),
    });
  };

  function buildProviders() {
    return [
      EmbedPosterService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: DiscordBotClientService,
        useValue: {
          isConnected: jest.fn().mockReturnValue(true),
          getGuildId: jest.fn().mockReturnValue('guild-123'),
          sendEmbed: jest.fn().mockResolvedValue(mockMessage),
          deleteMessage: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: DiscordEmbedFactory,
        useValue: {
          buildEventEmbed: jest
            .fn()
            .mockReturnValue({ embed: mockEmbed, row: mockRow }),
        },
      },
      {
        provide: ChannelResolverService,
        useValue: {
          resolveChannelForEvent: jest.fn().mockResolvedValue('channel-abc'),
          resolveVoiceChannelHonoringOverride: jest
            .fn()
            .mockResolvedValue(null),
        },
      },
      {
        provide: SettingsService,
        useValue: {
          getBranding: jest
            .fn()
            .mockResolvedValue({ communityName: 'Test Guild' }),
          getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
          getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
        },
      },
    ];
  }

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain([])),
      insert: jest
        .fn()
        .mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();
    service = module.get(EmbedPosterService);
    clientService = module.get(DiscordBotClientService);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('deletes the just-posted Discord message and resolves false when the discord_event_messages insert hits FK 23503', async () => {
    rejectInsertWith(fkError());

    const result = await service.postEmbed(42, baseEvent, null, null, null);

    expect(result).toBe(false);
    expect(clientService.deleteMessage).toHaveBeenCalledWith(
      'channel-abc',
      'msg-123',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Event 42 was deleted while its embed was posting',
      ),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('recognises a bare postgres error carrying code 23503 without a cause wrapper', async () => {
    rejectInsertWith(Object.assign(new Error('fk'), { code: '23503' }));

    const result = await service.postEmbed(42, baseEvent, null, null, null);

    expect(result).toBe(false);
    expect(clientService.deleteMessage).toHaveBeenCalledWith(
      'channel-abc',
      'msg-123',
    );
  });

  it('does not delete the message for a non-FK insert failure and keeps the error log', async () => {
    rejectInsertWith(Object.assign(new Error('dup'), { code: '23505' }));

    const result = await service.postEmbed(42, baseEvent, null, null, null);

    expect(result).toBe(false);
    expect(clientService.deleteMessage).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post embed for event 42'),
      expect.anything(),
    );
  });

  it('still resolves false and warns when deleting the orphan message itself fails', async () => {
    rejectInsertWith(fkError());
    clientService.deleteMessage.mockRejectedValue(new Error('Unknown Message'));

    const result = await service.postEmbed(42, baseEvent, null, null, null);

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not remove orphan embed msg-123'),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('isEventFkViolation returns false for null, non-objects and other SQLSTATEs', () => {
    expect(isEventFkViolation(null)).toBe(false);
    expect(isEventFkViolation('23503')).toBe(false);
    expect(isEventFkViolation({ code: '23505' })).toBe(false);
    expect(isEventFkViolation({ cause: { code: '23505' } })).toBe(false);
    expect(isEventFkViolation({ cause: { code: '23503' } })).toBe(true);
  });
});

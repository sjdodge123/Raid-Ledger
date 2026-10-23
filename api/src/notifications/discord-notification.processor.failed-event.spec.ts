/**
 * ROK-1933 Codex P2: the processor tells callers which queued DM finally
 * failed — on the terminal attempt or a permanent Discord error only.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { DiscordNotificationProcessor } from './discord-notification.processor';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DiscordNotificationService } from './discord-notification.service';
import { SettingsService } from '../settings/settings.service';
import { QueueHealthService } from '../queue/queue-health.service';
import {
  DISCORD_NOTIFICATION_QUEUE,
  type DiscordNotificationJobData,
} from './discord-notification.constants';
import { DISCORD_NOTIFICATION_FAILED } from './discord-notification.events';

const client = {
  isConnected: jest.fn(),
  sendEmbedDM: jest.fn(),
};
const notifications = {
  resetFailures: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn().mockResolvedValue(undefined),
  deactivateUser: jest.fn().mockResolvedValue(undefined),
  isUserDeactivated: jest.fn().mockResolvedValue(false),
  isGuildMemberSeen: jest.fn().mockResolvedValue(true),
  resolveRecipientTimezone: jest.fn().mockResolvedValue(undefined),
};
const emitter = { emit: jest.fn() };
const PAYLOAD = { profileId: 7 };

function job(attemptsMade: number): Job<DiscordNotificationJobData> {
  return {
    id: 'job-1',
    data: {
      notificationId: 'n-1',
      userId: 42,
      discordId: '123456789',
      type: 'valheim_claim_suggestion',
      title: 'Is Brannok yours?',
      message: 'm',
      payload: PAYLOAD,
    },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<DiscordNotificationJobData>;
}

function discordError(code: number): Error {
  const err = new Error(`code ${code}`);
  err.name = `DiscordAPIError[${code}]`;
  return Object.assign(err, { code });
}

let processor: DiscordNotificationProcessor;

beforeEach(async () => {
  jest.clearAllMocks();
  client.isConnected.mockReturnValue(true);
  client.sendEmbedDM.mockResolvedValue(undefined);
  const moduleRef = await Test.createTestingModule({
    providers: [
      DiscordNotificationProcessor,
      { provide: DiscordBotClientService, useValue: client },
      {
        provide: DiscordNotificationEmbedService,
        useValue: {
          buildNotificationEmbed: jest.fn().mockResolvedValue({ embed: {} }),
        },
      },
      { provide: DiscordNotificationService, useValue: notifications },
      {
        provide: SettingsService,
        useValue: { getBranding: jest.fn().mockResolvedValue({}) },
      },
      { provide: getQueueToken(DISCORD_NOTIFICATION_QUEUE), useValue: {} },
      { provide: QueueHealthService, useValue: { register: jest.fn() } },
      { provide: EventEmitter2, useValue: emitter },
    ],
  }).compile();
  processor = moduleRef.get(DiscordNotificationProcessor);
});

const FAILED = [
  DISCORD_NOTIFICATION_FAILED,
  { type: 'valheim_claim_suggestion', userId: 42, payload: PAYLOAD },
];

describe('DiscordNotificationProcessor — final-failure event', () => {
  it('emits on the final attempt of a transient send error', async () => {
    client.sendEmbedDM.mockRejectedValue(new Error('500'));
    await expect(processor.process(job(2))).rejects.toThrow('500');
    expect(emitter.emit.mock.calls).toEqual([FAILED]);
  });

  it('does not emit on a retryable attempt', async () => {
    client.sendEmbedDM.mockRejectedValue(new Error('500'));
    await expect(processor.process(job(0))).rejects.toThrow('500');
    await expect(processor.process(job(1))).rejects.toThrow('500');
    expect(emitter.emit.mock.calls).toEqual([]);
  });

  it('emits on the final attempt while the bot is offline', async () => {
    client.isConnected.mockReturnValue(false);
    await expect(processor.process(job(0))).rejects.toThrow();
    expect(emitter.emit.mock.calls).toEqual([]);
    await expect(processor.process(job(2))).rejects.toThrow();
    expect(emitter.emit.mock.calls).toEqual([FAILED]);
  });

  it.each([50007, 50278, 10013])(
    'emits on permanent Discord error %i, even on the first attempt',
    async (code) => {
      client.sendEmbedDM.mockRejectedValue(discordError(code));
      await processor.process(job(0));
      expect(emitter.emit.mock.calls).toEqual([FAILED]);
    },
  );

  it('does not emit when the DM is delivered', async () => {
    await processor.process(job(2));
    expect(emitter.emit.mock.calls).toEqual([]);
  });
});

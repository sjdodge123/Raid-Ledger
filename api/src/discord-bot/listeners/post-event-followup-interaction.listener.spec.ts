import { EventEmitter } from 'node:events';
import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import type { Logger } from '@nestjs/common';
import type { Client } from 'discord.js';
import { PostEventFollowupInteractionListener } from './post-event-followup-interaction.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { NotificationService } from '../../notifications/notification.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

// findLinkedUser is the linked-account lookup; mock the module so we control it.
jest.mock('./signup-interaction.helpers', () => ({
  findLinkedUser: jest.fn(),
}));
import { findLinkedUser } from './signup-interaction.helpers';
const mockFindLinkedUser = findLinkedUser as jest.Mock;

const ORGANIZER_ID = 77;
const EVENT_ID = 42;
const CLIENT_URL = 'https://raid.test';

interface TestableFollowupListener {
  onBotConnected: () => void;
  onBotDisconnected: () => void;
}

/**
 * A real EventEmitter stands in for the discord.js Client so `listenerCount`
 * reports the genuine number of live `interactionCreate` handlers. A jest.fn()
 * spy could only prove `on` was called — not that exactly one handler survives
 * a reconnect, which is the defect this file guards.
 */
function makeFakeClient(): EventEmitter & Client {
  return new EventEmitter() as unknown as EventEmitter & Client;
}

/** Minimal ButtonInteraction mock; `settled` resolves once the reply lands. */
function makeButtonInteraction(customId: string, userId = 'discord-user-1') {
  let markSettled!: () => void;
  const settled = new Promise<void>((resolve) => (markSettled = resolve));
  return {
    isButton: () => true,
    customId,
    user: { id: userId, username: 'Organizer' },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockImplementation(() => {
      markSettled();
      return Promise.resolve(undefined);
    }),
    settled,
  };
}

let testModule: TestingModule;
let listener: TestableFollowupListener;
let logger: Logger;
let mockClientService: { getClient: jest.Mock };
let mockDb: {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
};

async function setup() {
  jest.clearAllMocks();
  mockClientService = { getClient: jest.fn().mockReturnValue(null) };
  mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([
      {
        id: EVENT_ID,
        title: 'Raid Night',
        creatorId: ORGANIZER_ID,
        gameId: 5,
      },
    ]),
  };
  mockFindLinkedUser.mockResolvedValue({ id: ORGANIZER_ID });

  testModule = await Test.createTestingModule({
    providers: [
      PostEventFollowupInteractionListener,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: ModuleRef, useValue: { get: jest.fn(() => ({})) } },
      { provide: NotificationService, useValue: { createMany: jest.fn() } },
      {
        provide: SettingsService,
        useValue: { getClientUrl: jest.fn().mockResolvedValue(CLIENT_URL) },
      },
    ],
  }).compile();

  listener = testModule.get(PostEventFollowupInteractionListener);
  logger = (listener as unknown as { logger: Logger }).logger;
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger, 'error').mockImplementation(() => undefined);
}

/** Let the handler's remaining microtasks (the outcome log) run to completion. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Every string passed to logger.log, flattened for substring assertions. */
function loggedLines(): string {
  return (logger.log as jest.Mock).mock.calls.flat().join('\n');
}

describe('PostEventFollowupInteractionListener', () => {
  beforeEach(setup);
  afterEach(async () => {
    await testModule.close();
  });

  describe('Regression: ROK-1425 — attach lifecycle', () => {
    it('leaves exactly ONE live handler across CONNECTED → DISCONNECTED → CONNECTED', () => {
      const first = makeFakeClient();
      const second = makeFakeClient();

      mockClientService.getClient.mockReturnValue(first);
      listener.onBotConnected();
      expect(first.listenerCount('interactionCreate')).toBe(1);

      listener.onBotDisconnected();
      expect(first.listenerCount('interactionCreate')).toBe(0);

      mockClientService.getClient.mockReturnValue(second);
      listener.onBotConnected();

      // No orphan on the torn-down client, exactly one on the live client.
      expect(first.listenerCount('interactionCreate')).toBe(0);
      expect(second.listenerCount('interactionCreate')).toBe(1);
    });

    it('still handles a button click that arrives after a reconnect', async () => {
      const first = makeFakeClient();
      const second = makeFakeClient();

      mockClientService.getClient.mockReturnValue(first);
      listener.onBotConnected();
      listener.onBotDisconnected();
      mockClientService.getClient.mockReturnValue(second);
      listener.onBotConnected();

      const interaction = makeButtonInteraction(`pef_schedule:${EVENT_ID}`);
      second.emit('interactionCreate', interaction);
      await interaction.settled;

      // The bug was a silent no-ack — Discord's red "This interaction failed".
      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining(
          `${CLIENT_URL}/events/new?followupForEventId=${EVENT_ID}`,
        ),
      });
    });

    it('does not stack handlers when CONNECTED fires twice without DISCONNECTED', () => {
      const client = makeFakeClient();
      mockClientService.getClient.mockReturnValue(client);

      listener.onBotConnected();
      listener.onBotConnected();

      expect(client.listenerCount('interactionCreate')).toBe(1);

      const interaction = makeButtonInteraction(`pef_poll:${EVENT_ID}`);
      client.emit('interactionCreate', interaction);

      // A stacked handler would defer (and therefore act) twice.
      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    });

    it('re-attaching to a NEW client without DISCONNECTED kills the old binding', () => {
      const destroyed = makeFakeClient();
      const live = makeFakeClient();

      mockClientService.getClient.mockReturnValue(destroyed);
      listener.onBotConnected();
      mockClientService.getClient.mockReturnValue(live);
      listener.onBotConnected();

      expect(destroyed.listenerCount('interactionCreate')).toBe(0);
      expect(live.listenerCount('interactionCreate')).toBe(1);
    });

    it('warns instead of silently returning when the client is unavailable', () => {
      mockClientService.getClient.mockReturnValue(null);

      expect(() => listener.onBotConnected()).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Discord client unavailable'),
      );
    });

    it('onBotDisconnected is safe when nothing was ever attached', () => {
      expect(() => listener.onBotDisconnected()).not.toThrow();
    });
  });

  describe('Regression: ROK-1425 — interaction logging', () => {
    let client: EventEmitter & Client;

    beforeEach(() => {
      client = makeFakeClient();
      mockClientService.getClient.mockReturnValue(client);
      listener.onBotConnected();
    });

    it('logs receipt and terminal outcome with customId + discord user', async () => {
      const interaction = makeButtonInteraction(
        `pef_schedule:${EVENT_ID}`,
        'discord-organizer',
      );
      client.emit('interactionCreate', interaction);
      await interaction.settled;
      await flush();

      const lines = loggedLines();
      expect(lines).toContain('Follow-up button received');
      expect(lines).toContain(`customId=pef_schedule:${EVENT_ID}`);
      expect(lines).toContain('discordUserId=discord-organizer');
      expect(lines).toContain('outcome=schedule');
    });

    it('logs the gating outcome when the clicker is not the organizer', async () => {
      mockFindLinkedUser.mockResolvedValue({ id: ORGANIZER_ID + 1 });
      const interaction = makeButtonInteraction(`pef_schedule:${EVENT_ID}`);

      client.emit('interactionCreate', interaction);
      await interaction.settled;
      await flush();

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Only the organizer can do this.',
      });
      expect(loggedLines()).toContain('outcome=not-organizer');
    });

    it('logs a warning when the defer fails (the silent-failure signature)', async () => {
      const interaction = makeButtonInteraction(`pef_schedule:${EVENT_ID}`);
      interaction.deferReply.mockRejectedValue(
        new Error('Unknown interaction'),
      );

      client.emit('interactionCreate', interaction);
      await flush();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('defer failed'),
      );
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('stays silent for custom ids owned by other listeners', () => {
      const interaction = makeButtonInteraction('signup:42');

      client.emit('interactionCreate', interaction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(loggedLines()).not.toContain('Follow-up button received');
    });
  });
});

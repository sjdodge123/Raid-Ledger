/**
 * ROK-1933 Part 4 — unit: `setChannel` / `clearChannel` announce the binding
 * change on the app event bus AFTER it is saved, and a throwing listener
 * never fails the bind (fire-and-forget). Real-DB paths: the integration spec.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import * as queries from './guild-discord.queries';
import * as core from './guild-core.queries';
import { GuildDiscordService } from './guild-discord.service';
import { HUB_CHANNEL_EVENTS } from './hub-channel.events';
import type { GuildAccessService, GuildActor } from './guild-access.service';
import type { ChannelMirrorService } from '../discord-bot/channel-mirror/channel-mirror.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

const actor = { id: 5, role: 'admin' } as unknown as GuildActor;
const list = {
  connected: true,
  channels: [
    { id: '222222222222222222', name: 'general', visibility: 'public' },
  ],
};

function build(emit: jest.Mock) {
  const db = drizzle.mock({ schema });
  const mirror = {
    listReadableTextChannels: () => list,
    clear: jest.fn(),
    read: jest.fn().mockResolvedValue({ state: 'unavailable' }),
  } as unknown as ChannelMirrorService;
  const client = {
    getGuildInfo: () => null,
  } as unknown as DiscordBotClientService;
  const events = { emit } as unknown as EventEmitter2;
  const access = {} as GuildAccessService;
  return new GuildDiscordService(db, access, mirror, client, events);
}

beforeEach(() => {
  jest.spyOn(core, 'findGuild').mockResolvedValue({ id: 9 } as never);
  jest
    .spyOn(queries, 'findBoundChannelId')
    .mockResolvedValue('111111111111111111');
  jest.spyOn(queries, 'findBinding').mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe('GuildDiscordService hub.channel events', () => {
  it('setChannel emits LINKED with the previous channel after saving', async () => {
    const save = jest.spyOn(queries, 'saveBinding').mockResolvedValue();
    const emit = jest.fn(() => {
      expect(save).toHaveBeenCalled();
      return true;
    });
    await build(emit).setChannel(actor, 9, { channelId: '222222222222222222' });
    expect(emit).toHaveBeenCalledWith(HUB_CHANNEL_EVENTS.LINKED, {
      guildId: 9,
      channelId: '222222222222222222',
      previousChannelId: '111111111111111111',
    });
  });

  it('clearChannel emits CLEARED with the channel it unbound', async () => {
    jest.spyOn(queries, 'clearBinding').mockResolvedValue();
    const emit = jest.fn(() => true);
    await build(emit).clearChannel(9);
    expect(emit).toHaveBeenCalledWith(HUB_CHANNEL_EVENTS.CLEARED, {
      guildId: 9,
      previousChannelId: '111111111111111111',
    });
  });

  it('a throwing listener never fails the bind', async () => {
    jest.spyOn(queries, 'saveBinding').mockResolvedValue();
    const emit = jest.fn(() => {
      throw new Error('discord down');
    });
    await expect(
      build(emit).setChannel(actor, 9, { channelId: '222222222222222222' }),
    ).resolves.toBeDefined();
  });
});

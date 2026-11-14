/**
 * Operator ruling 2026-11-13: every surface shows a PLANNED temporary voice
 * channel. A PUG/member invite DM sent before the channel exists used to link
 * the game's default room; it now shows the planned name + open time, and a
 * live temporary channel still renders as a `<#id>` link.
 */
import { PugInviteService } from './pug-invite.service';
import type { ChannelResolverService } from './channel-resolver.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { SettingsService } from '../../settings/settings.service';
import * as schema from '../../drizzle/schema';

const START = new Date(Date.now() + 3 * 24 * 3_600_000);

/**
 * `select().from(table).where().limit()` resolving to the rows for `table`,
 * so the result does not depend on the order the service issues its reads.
 */
function tableChain(rowsFor: (table: unknown) => unknown[]) {
  const chain: Record<string, jest.Mock> = {};
  let rows: unknown[] = [];
  chain.from = jest.fn((table: unknown) => {
    rows = rowsFor(table);
    return chain;
  });
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn(() => Promise.resolve(rows));
  chain.then = jest.fn((ok: (v: unknown[]) => unknown) => ok(rows));
  return chain;
}

function build(liveChannelId: string | null) {
  const sendEmbedDM = jest.fn().mockResolvedValue(undefined);
  const client = {
    isConnected: () => true,
    getGuildId: () => 'guild-1',
    sendEmbedDM,
  } as unknown as DiscordBotClientService;
  const resolve = jest
    .fn()
    .mockImplementation((_g, _r, eph: string | null) =>
      Promise.resolve(eph ?? 'default-vc'),
    );
  const resolver = {
    resolveVoiceChannelHonoringOverride: resolve,
    overrideIsVoiceChannel: jest.fn().mockReturnValue(true),
  } as unknown as ChannelResolverService;
  const settings = {
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Guild' }),
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(true),
    getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
    getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(30),
  } as unknown as SettingsService;
  const event = {
    id: 42,
    title: 'Weekly Raid',
    cancelledAt: null,
    reschedulingPollId: null,
    duration: [START, new Date(START.getTime() + 3 * 3_600_000)],
    gameId: 1,
    maxAttendees: 8,
    recurrenceGroupId: null,
    ephemeralVoiceEnabled: true,
    ephemeralVoiceChannelId: liveChannelId,
    notificationChannelOverride: null,
  };
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.events) return [event];
    if (table === schema.games) return [{ name: 'World of Warcraft' }];
    return [{ value: 2 }];
  };
  const db = { select: jest.fn(() => tableChain(rowsFor)) };
  const service = new PugInviteService(db as never, client, resolver, settings);
  return { service, sendEmbedDM };
}

/** The DM's Voice Channel field value, if any. */
function voiceField(sendEmbedDM: jest.Mock): string | undefined {
  const embed = sendEmbedDM.mock.calls[0]?.[1] as {
    toJSON: () => { fields?: Array<{ name: string; value: string }> };
  };
  return embed.toJSON().fields?.find((f) => f.name === 'Voice Channel')?.value;
}

describe('PugInviteService — planned temporary voice channel on invite DMs', () => {
  it('shows the planned name + open time, never a link to the default room', async () => {
    const { service, sendEmbedDM } = build(null);

    await service.sendMemberInviteDm(42, 'discord-user-1', 'notif-1', 1);

    const value = voiceField(sendEmbedDM) ?? '';
    const opens = Math.floor((START.getTime() - 30 * 60_000) / 1000);
    expect(value).toContain('Weekly Raid');
    expect(value).toContain('World of Warcraft');
    expect(value).toContain(`opens <t:${opens}:t>`);
    expect(value).not.toContain('<#');
  });

  it('links the live temporary channel once it exists', async () => {
    const { service, sendEmbedDM } = build('eph-vc-1');

    await service.sendMemberInviteDm(42, 'discord-user-1', 'notif-1', 1);

    expect(voiceField(sendEmbedDM)).toBe('<#eph-vc-1>');
  });
});

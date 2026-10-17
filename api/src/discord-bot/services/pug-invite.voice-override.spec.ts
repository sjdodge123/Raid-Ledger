/**
 * TDB:174a — the member/PUG invite DM's Join-Voice link honours the event's
 * voice `notificationChannelOverride`, exactly like reminders, the website and
 * embeds (ROK-1389). Wired with the REAL ChannelResolverService so the test
 * proves the voice-ness guard end to end, not just an argument threading.
 */
import { PugInviteService } from './pug-invite.service';
import { ChannelResolverService } from './channel-resolver.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { ChannelBindingsService } from './channel-bindings.service';
import type { SettingsService } from '../../settings/settings.service';

const OVERRIDE = 'override-ch-1';
const SERIES_VOICE = 'series-voice-1';

/** `select().from().where().limit()` resolving to `rows`. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

/** Guild cache where the override channel is voice, text, or unknown. */
function guildWith(kind: 'voice' | 'text' | 'uncached') {
  const channel = { isVoiceBased: () => kind === 'voice' };
  return {
    channels: {
      cache: {
        get: (id: string) =>
          id === OVERRIDE && kind !== 'uncached' ? channel : undefined,
      },
    },
  };
}

function build(kind: 'voice' | 'text' | 'uncached') {
  const sendEmbedDM = jest.fn().mockResolvedValue(undefined);
  const client = {
    isConnected: () => true,
    getGuild: () => guildWith(kind),
    getGuildId: () => 'guild-1',
    sendEmbedDM,
  } as unknown as DiscordBotClientService;
  const bindings = {
    getVoiceChannelForSeries: jest.fn().mockResolvedValue(SERIES_VOICE),
    getVoiceChannelForGame: jest.fn().mockResolvedValue(null),
  } as unknown as ChannelBindingsService;
  const settings = {
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Guild' }),
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    getDiscordBotDefaultVoiceChannel: jest.fn().mockResolvedValue(null),
  } as unknown as SettingsService;
  const resolver = new ChannelResolverService(settings, bindings, client);
  const event = {
    id: 42,
    title: 'Weekly Raid',
    cancelledAt: null,
    duration: [new Date('2026-02-20T20:00:00Z'), new Date('2026-02-20T23:00Z')],
    gameId: 1,
    maxAttendees: 8,
    recurrenceGroupId: 'rg-1',
    ephemeralVoiceChannelId: null,
    notificationChannelOverride: OVERRIDE,
  };
  const db = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectChain([event]))
      .mockReturnValueOnce(selectChain([{ value: 2 }])),
  };
  const service = new PugInviteService(db as never, client, resolver, settings);
  return { service, sendEmbedDM };
}

/** The `<#id>` value of the DM's Voice Channel field, if any. */
function voiceField(sendEmbedDM: jest.Mock): string | undefined {
  const embed = sendEmbedDM.mock.calls[0]?.[1] as {
    toJSON: () => { fields?: Array<{ name: string; value: string }> };
  };
  return embed.toJSON().fields?.find((f) => f.name === 'Voice Channel')?.value;
}

describe('PugInviteService — voice override on invite DMs (TDB:174a)', () => {
  it('points the Join-Voice link at a voice override', async () => {
    const { service, sendEmbedDM } = build('voice');

    await service.sendMemberInviteDm(42, 'discord-user-1', 'notif-1', 1);

    expect(voiceField(sendEmbedDM)).toBe(`<#${OVERRIDE}>`);
  });

  it('uses an override the guild cache does not know (optimistic)', async () => {
    const { service, sendEmbedDM } = build('uncached');

    await service.sendMemberInviteDm(42, 'discord-user-1', 'notif-1', 1);

    expect(voiceField(sendEmbedDM)).toBe(`<#${OVERRIDE}>`);
  });

  it('falls through to the series binding when the override is a text channel', async () => {
    const { service, sendEmbedDM } = build('text');

    await service.sendMemberInviteDm(42, 'discord-user-1', 'notif-1', 1);

    expect(voiceField(sendEmbedDM)).toBe(`<#${SERIES_VOICE}>`);
  });
});

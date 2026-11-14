/**
 * The DM embed renders a PLANNED temporary voice channel with the same line the
 * event embeds use (`plannedVoiceLine`, PR #2134), and a DM without one keeps
 * the `<#id>` channel link.
 */
// The shared mock lacks escapeMarkdown, which `plannedVoiceLine` uses.
jest.mock('discord.js', () => ({
  ...jest.requireActual('../common/testing/discord-js-mock').discordJsMock,
  escapeMarkdown: jest.requireActual('discord.js').escapeMarkdown,
}));

import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';
import { buildReminderPayload } from './event-reminder.helpers';

type EmbedFields = Array<{ name: string; value: string }>;

const OPENS_AT = '2026-11-20T19:45:00.000Z';
const PLANNED = { name: 'Stocks 5 man', opensAt: OPENS_AT };
const UNIX = Math.floor(new Date(OPENS_AT).getTime() / 1000);

describe('DM embed — planned temporary voice channel', () => {
  let service: DiscordNotificationEmbedService;

  beforeEach(() => {
    delete process.env.CLIENT_URL;
    const settings = {
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    };
    service = new DiscordNotificationEmbedService(
      settings as unknown as SettingsService,
    );
  });

  async function voiceField(payload: Record<string, unknown>) {
    const { embed } = await service.buildNotificationEmbed(
      {
        notificationId: 'n-1',
        type: 'event_reminder',
        title: 'Starting Soon!',
        message: 'Your event starts in 3 days',
        payload: { eventId: 42, ...payload },
      },
      'Test Community',
    );
    const json = embed.toJSON() as { fields?: EmbedFields };
    return json.fields?.find((f) => f.name === 'Voice Channel');
  }

  it('shows the planned channel name and open time', async () => {
    const field = await voiceField({ plannedVoiceChannel: PLANNED });
    expect(field?.value).toBe(`\u{1F50A} Stocks 5 man · opens <t:${UNIX}:t>`);
  });

  it('keeps the channel link when nothing is planned', async () => {
    const field = await voiceField({ voiceChannelId: '111222333' });
    expect(field?.value).toBe('<#111222333>');
  });

  it('ignores a malformed planned value', async () => {
    const field = await voiceField({ plannedVoiceChannel: { name: 3 } });
    expect(field).toBeUndefined();
  });
});

describe('buildReminderPayload — planned temporary voice channel', () => {
  const base = {
    eventId: 42,
    windowType: '24h',
    characterDisplay: null,
    startTime: new Date('2026-11-20T20:00:00.000Z'),
  };

  it('carries the planned channel into the DM payload', () => {
    const payload = buildReminderPayload({
      ...base,
      plannedVoiceChannel: PLANNED,
    });
    expect(payload.plannedVoiceChannel).toEqual(PLANNED);
    expect(payload.voiceChannelId).toBeUndefined();
  });

  it('is unchanged without a planned channel', () => {
    const payload = buildReminderPayload({ ...base, voiceChannelId: 'v-1' });
    expect(payload).not.toHaveProperty('plannedVoiceChannel');
    expect(payload.voiceChannelId).toBe('v-1');
  });
});

/**
 * The planned temporary voice line (operator ruling 2026-11-13) on the channel
 * body and the invite DM: `🔊 ⏰ Stocks 5 man · opens <t:…:t>`.
 */
import { EMBED_STATES } from '../discord-bot.constants';
import {
  buildEventBody,
  plannedVoiceLine,
} from './discord-embed-event-body.helpers';
import { createInviteEmbed } from './discord-embed-invite.helpers';
import type { EmbedEventData } from './discord-embed.factory';

const OPENS = '2026-11-20T20:00:00.000Z';
const UNIX = Math.floor(new Date(OPENS).getTime() / 1000);
const PLANNED = { name: '⏰ Stocks 5 man', opensAt: OPENS };

const EVENT: EmbedEventData = {
  id: 7,
  title: 'Stocks 5 man',
  startTime: '2026-11-20T20:30:00.000Z',
  endTime: '2026-11-20T22:30:00.000Z',
  signupCount: 0,
};

function body(event: EmbedEventData): string {
  return buildEventBody(event, {
    state: EMBED_STATES.POSTED,
    eventLink: false,
  });
}

describe('plannedVoiceLine', () => {
  it('renders the ruled wording with a short-time Discord timestamp', () => {
    expect(plannedVoiceLine(PLANNED)).toBe(
      `🔊 ⏰ Stocks 5 man · opens <t:${UNIX}:t>`,
    );
  });

  it('cannot render a mention, channel link or masked link from the name', () => {
    const line = plannedVoiceLine({
      name: '⏰ @everyone <#123> [x](https://evil.example)',
      opensAt: OPENS,
    });
    expect(line).not.toContain('@everyone');
    expect(line).not.toMatch(/<#\d+>/);
    expect(line).not.toContain('[x](');
  });
});

describe('buildEventBody — planned voice', () => {
  it('shows the planned line when no voice channel is bound', () => {
    const text = body({ ...EVENT, plannedVoiceChannel: PLANNED });
    expect(text).toContain(`🔊 ⏰ Stocks 5 man · opens <t:${UNIX}:t>`);
  });

  it('a live voice channel wins over the planned one', () => {
    const text = body({
      ...EVENT,
      voiceChannelId: 'vc-9',
      plannedVoiceChannel: PLANNED,
    });
    expect(text).toContain('🔊 <#vc-9>');
    expect(text).not.toContain('opens <t:');
  });
});

describe('createInviteEmbed — planned voice', () => {
  function description(event: EmbedEventData): string {
    return createInviteEmbed(event, {}, 'roknua').toJSON().description ?? '';
  }

  it('shows the planned line when no voice channel is bound', () => {
    const text = description({ ...EVENT, plannedVoiceChannel: PLANNED });
    expect(text).toContain(`🔊 ⏰ Stocks 5 man · opens <t:${UNIX}:t>`);
  });

  it('a live voice channel wins over the planned one', () => {
    const text = description({
      ...EVENT,
      voiceChannelId: 'vc-9',
      plannedVoiceChannel: PLANNED,
    });
    expect(text).toContain('🔊 <#vc-9>');
    expect(text).not.toContain('opens <t:');
  });
});

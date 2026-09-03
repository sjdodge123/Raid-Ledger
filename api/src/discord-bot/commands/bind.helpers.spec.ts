import {
  buildBindSuccessEmbed,
  buildEventBindEmbed,
  shouldDeriveSeriesGame,
} from './bind.helpers';
import { EMBED_COLORS } from '../discord-bot.constants';

/**
 * ROK-1372: a variety-series VOICE bind must not auto-derive a single game
 * (which would lock the channel to game-voice-monitor and mislabel every
 * quick-play, e.g. gamernight → HELLCARD). Text/announce binds still derive.
 */
describe('shouldDeriveSeriesGame (ROK-1372)', () => {
  it('does NOT derive a game for a voice bind with no explicit game', () => {
    // → gameId stays null → general-lobby (presence auto-detect)
    expect(shouldDeriveSeriesGame('voice', false)).toBe(false);
  });

  it('derives a game for a text/announce bind with no explicit game', () => {
    // announcements route by game, so derivation is intended
    expect(shouldDeriveSeriesGame('text', false)).toBe(true);
  });

  it('never derives when an explicit game was supplied (voice or text)', () => {
    expect(shouldDeriveSeriesGame('voice', true)).toBe(false);
    expect(shouldDeriveSeriesGame('text', true)).toBe(false);
  });
});

/**
 * ROK-1462 slice D rewrote these builders onto the shared command-reply chrome
 * (D5/D6): slate `done` colour from the chrome, state in the author line,
 * settings as inline fields. The `⚠ Replaced previous binding` line and the
 * ROK-1351 other-slot line stay in the description.
 */
describe('buildBindSuccessEmbed (ROK-1462 D5/D6)', () => {
  it('uses the slate done colour and the BINDING SAVED author line', () => {
    const { embed } = buildBindSuccessEmbed(
      'general',
      'general-lobby',
      null,
      null,
      [],
    );
    expect(embed.data.color).toBe(EMBED_COLORS.SYSTEM);
    expect(embed.data.author?.name).toBe('⚙ BINDING SAVED');
  });

  it('renders the settings as inline fields, not prose', () => {
    const { embed } = buildBindSuccessEmbed(
      'general',
      'general-lobby',
      null,
      null,
      [],
    );
    expect(embed.data.fields).toEqual([
      { name: 'Channel', value: '#general → General Lobby', inline: true },
      { name: 'Minimum players', value: '2 per game', inline: true },
      { name: 'Just Chatting', value: 'Disabled', inline: true },
      { name: 'Auto-close', value: '5 min after group empties', inline: true },
    ]);
    expect(embed.data.description ?? '').not.toContain('Minimum players');
  });

  it('honours the stored config in the field values', () => {
    const { embed } = buildBindSuccessEmbed(
      'raid-voice',
      'game-voice-monitor',
      null,
      'Deep Rock Galactic',
      [],
      null,
      { minPlayers: 4, gracePeriod: 12 },
    );
    expect(embed.data.fields).toContainEqual({
      name: 'Minimum players',
      value: '4 in channel',
      inline: true,
    });
    expect(embed.data.fields).toContainEqual({
      name: 'Auto-close',
      value: '12 min after group empties',
      inline: true,
    });
  });

  it('keeps the replaced-binding warning and the other-slot line', () => {
    const { embed } = buildBindSuccessEmbed(
      'announcements',
      'game-announcements',
      'Friday Deep Dive',
      'Valheim',
      ['old-1'],
      { channelType: 'voice', channelId: 'voice-9' },
    );
    expect(embed.data.description).toContain('Replaced previous binding');
    expect(embed.data.description).toContain('<#old-1>');
    expect(embed.data.description).toContain(
      'Voice host: <#voice-9> (unchanged)',
    );
  });

  it('has no title and no description at all for a plain bind', () => {
    const { embed } = buildBindSuccessEmbed(
      'general',
      'general-lobby',
      null,
      null,
      [],
    );
    expect(embed.data.title).toBeUndefined();
    expect(embed.data.description).toBeUndefined();
  });

  it('still offers the admin-panel link row', () => {
    process.env.CLIENT_URL = 'https://rl.test';
    try {
      const { components } = buildBindSuccessEmbed(
        'general',
        'general-lobby',
        null,
        null,
        [],
      );
      expect(components).toHaveLength(1);
    } finally {
      delete process.env.CLIENT_URL;
    }
  });
});

describe('buildEventBindEmbed (ROK-1462 D5)', () => {
  it('uses the slate done colour and the EVENT BINDING SAVED author line', () => {
    const embed = buildEventBindEmbed('Raid Night', [
      'Game reassigned to **Valheim**',
    ]);
    expect(embed.data.color).toBe(EMBED_COLORS.SYSTEM);
    expect(embed.data.author?.name).toBe('⚙ EVENT BINDING SAVED');
  });

  it('keeps the event title and the change list in the description', () => {
    const embed = buildEventBindEmbed('Raid Night', [
      'Notification channel set to **#a**',
    ]);
    expect(embed.data.description).toContain('Raid Night');
    expect(embed.data.description).toContain(
      'Notification channel set to **#a**',
    );
  });
});

import { EmbedBuilder } from 'discord.js';
import { applySubscribedGameEmbed } from './notification-embed.subscribed-game';

function freshEmbed() {
  return new EmbedBuilder();
}

describe('applySubscribedGameEmbed — description', () => {
  it('sets description with game name line', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, { gameName: 'World of Warcraft' });
    expect(embed.data.description).toBe('🎮 **World of Warcraft**');
  });

  it('includes Discord timestamp with duration when start and end provided', () => {
    const embed = freshEmbed();
    const start = '2026-03-20T20:00:00Z';
    const end = '2026-03-20T22:00:00Z';
    const unix = Math.floor(new Date(start).getTime() / 1000);

    applySubscribedGameEmbed(embed, {
      gameName: 'WoW',
      startTime: start,
      endTime: end,
    });

    const desc = embed.data.description!;
    expect(desc).toContain(`<t:${unix}:f>`);
    expect(desc).toContain(`(<t:${unix}:R>)`);
    expect(desc).toContain('(2h)');
  });

  it('omits duration suffix when endTime is missing', () => {
    const embed = freshEmbed();
    const start = '2026-03-20T20:00:00Z';
    const unix = Math.floor(new Date(start).getTime() / 1000);

    applySubscribedGameEmbed(embed, { gameName: 'WoW', startTime: start });

    const desc = embed.data.description!;
    expect(desc).toContain(`<t:${unix}:f>`);
    expect(desc).not.toContain('(2h)');
  });

  it('includes voice channel link when voiceChannelId provided', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, {
      gameName: 'WoW',
      voiceChannelId: '123456789',
    });
    expect(embed.data.description).toContain('🔊 <#123456789>');
  });

  it('omits voice channel line when voiceChannelId absent', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, { gameName: 'WoW' });
    expect(embed.data.description).not.toContain('🔊');
  });

  it('does not set description when payload has no relevant fields', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, {});
    expect(embed.data.description).toBeUndefined();
  });
});

describe('applySubscribedGameEmbed — thumbnail', () => {
  it('sets thumbnail from gameCoverUrl', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, {
      gameName: 'WoW',
      gameCoverUrl: 'https://example.com/cover.jpg',
    });
    expect(embed.data.thumbnail?.url).toBe('https://example.com/cover.jpg');
  });

  it('does not set thumbnail when gameCoverUrl is empty', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, { gameName: 'WoW', gameCoverUrl: '' });
    expect(embed.data.thumbnail).toBeUndefined();
  });

  it('does not set thumbnail when gameCoverUrl is missing', () => {
    const embed = freshEmbed();
    applySubscribedGameEmbed(embed, { gameName: 'WoW' });
    expect(embed.data.thumbnail).toBeUndefined();
  });
});

describe('applySubscribedGameEmbed — full payload', () => {
  it('renders all lines in correct order with thumbnail', () => {
    const embed = freshEmbed();
    const start = '2026-03-20T20:00:00Z';
    const end = '2026-03-20T22:30:00Z';

    applySubscribedGameEmbed(embed, {
      gameName: 'Final Fantasy XIV',
      startTime: start,
      endTime: end,
      voiceChannelId: '999',
      gameCoverUrl: 'https://example.com/ff.jpg',
    });

    const lines = embed.data.description!.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('🎮 **Final Fantasy XIV**');
    expect(lines[1]).toContain('📆');
    expect(lines[1]).toContain('(2h 30m)');
    expect(lines[2]).toBe('🔊 <#999>');
    expect(embed.data.thumbnail?.url).toBe('https://example.com/ff.jpg');
  });
});

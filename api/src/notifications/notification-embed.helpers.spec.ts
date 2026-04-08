/**
 * Tests for generic gameCoverUrl thumbnail guard in addTypeSpecificFields (ROK-1021).
 * The subscribed_game variant has its own tests in notification-embed.subscribed-game.spec.ts.
 * These tests cover the generic path for all other notification types.
 */
import { EmbedBuilder } from 'discord.js';
import { addTypeSpecificFields } from './notification-embed.helpers';

function freshEmbed(): EmbedBuilder {
  return new EmbedBuilder();
}

describe('addTypeSpecificFields — generic gameCoverUrl thumbnail', () => {
  it('sets thumbnail when gameCoverUrl is a non-empty string', () => {
    const embed = freshEmbed();
    addTypeSpecificFields(embed, 'new_event', {
      gameCoverUrl: 'https://example.com/cover.jpg',
      gameName: 'Test Game',
    });
    expect(embed.data.thumbnail?.url).toBe('https://example.com/cover.jpg');
  });

  it('skips thumbnail when gameCoverUrl is an empty string', () => {
    const embed = freshEmbed();
    addTypeSpecificFields(embed, 'new_event', {
      gameCoverUrl: '',
      gameName: 'Test Game',
    });
    expect(embed.data.thumbnail).toBeUndefined();
  });

  it('skips thumbnail when gameCoverUrl is missing from payload', () => {
    const embed = freshEmbed();
    addTypeSpecificFields(embed, 'new_event', {
      gameName: 'Test Game',
    });
    expect(embed.data.thumbnail).toBeUndefined();
  });

  it('skips thumbnail when gameCoverUrl is null', () => {
    const embed = freshEmbed();
    addTypeSpecificFields(embed, 'new_event', {
      gameCoverUrl: null,
      gameName: 'Test Game',
    });
    expect(embed.data.thumbnail).toBeUndefined();
  });

  it('skips thumbnail when payload is undefined', () => {
    const embed = freshEmbed();
    addTypeSpecificFields(embed, 'new_event', undefined);
    expect(embed.data.thumbnail).toBeUndefined();
  });
});

describe('addTypeSpecificFields — subscribed_game delegates thumbnail', () => {
  it('does not double-set thumbnail via generic path for subscribed_game', () => {
    const embed = freshEmbed();
    const setThumbnailSpy = jest.spyOn(embed, 'setThumbnail');

    addTypeSpecificFields(embed, 'subscribed_game', {
      gameName: 'WoW',
      gameCoverUrl: 'https://example.com/wow.jpg',
    });

    // subscribed_game calls applySubscribedGameEmbed which sets thumbnail once.
    // The generic guard at line 157 should NOT execute for subscribed_game.
    // setThumbnail should be called exactly once (by applySubscribedGameEmbed).
    expect(setThumbnailSpy).toHaveBeenCalledTimes(1);
    expect(embed.data.thumbnail?.url).toBe('https://example.com/wow.jpg');

    setThumbnailSpy.mockRestore();
  });
});

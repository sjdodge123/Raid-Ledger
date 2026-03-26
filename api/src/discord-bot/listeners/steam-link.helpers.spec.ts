/**
 * TDD tests for steam-link.helpers.ts — pure URL parsing (ROK-966).
 *
 * These tests define the expected behavior of parseSteamAppIds(),
 * which extracts Steam store app IDs from Discord message content.
 *
 * The implementation file does NOT exist yet. These tests MUST fail
 * with "Cannot find module" until the dev agent creates the source.
 */
import { parseSteamAppIds } from './steam-link.helpers';

describe('parseSteamAppIds', () => {
  describe('basic URL extraction', () => {
    it('extracts a single Steam store URL', () => {
      const result = parseSteamAppIds(
        'Check this out https://store.steampowered.com/app/730/CounterStrike_2/',
      );
      expect(result).toEqual([730]);
    });

    it('extracts app ID from minimal URL without trailing path', () => {
      const result = parseSteamAppIds('https://store.steampowered.com/app/570');
      expect(result).toEqual([570]);
    });

    it('extracts multiple distinct Steam URLs from one message', () => {
      const content = [
        'Game 1: https://store.steampowered.com/app/730/CS2/',
        'Game 2: https://store.steampowered.com/app/570/Dota_2/',
      ].join('\n');

      const result = parseSteamAppIds(content);
      expect(result).toEqual([730, 570]);
    });

    it('handles URL with trailing slash only', () => {
      const result = parseSteamAppIds(
        'https://store.steampowered.com/app/1091500/',
      );
      expect(result).toEqual([1091500]);
    });
  });

  describe('deduplication', () => {
    it('deduplicates the same app ID appearing multiple times', () => {
      const content =
        'https://store.steampowered.com/app/730/CS2/ and also https://store.steampowered.com/app/730/CounterStrike/';

      const result = parseSteamAppIds(content);
      expect(result).toEqual([730]);
    });
  });

  describe('cap at 3 URLs per message', () => {
    it('returns at most 3 app IDs even if more are present', () => {
      const content = [
        'https://store.steampowered.com/app/100/A/',
        'https://store.steampowered.com/app/200/B/',
        'https://store.steampowered.com/app/300/C/',
        'https://store.steampowered.com/app/400/D/',
        'https://store.steampowered.com/app/500/E/',
      ].join(' ');

      const result = parseSteamAppIds(content);
      expect(result).toHaveLength(3);
      expect(result).toEqual([100, 200, 300]);
    });
  });

  describe('empty / no-match cases', () => {
    it('returns empty array for messages with no URLs', () => {
      const result = parseSteamAppIds('Just chatting about games');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      const result = parseSteamAppIds('');
      expect(result).toEqual([]);
    });

    it('returns empty array for non-Steam URLs', () => {
      const result = parseSteamAppIds(
        'Check https://example.com/app/730 and https://epicgames.com/store/p/fortnite',
      );
      expect(result).toEqual([]);
    });
  });

  describe('HTTP and HTTPS variants', () => {
    it('extracts from HTTP (non-HTTPS) URLs', () => {
      const result = parseSteamAppIds(
        'http://store.steampowered.com/app/730/CS2/',
      );
      expect(result).toEqual([730]);
    });

    it('extracts from HTTPS URLs', () => {
      const result = parseSteamAppIds(
        'https://store.steampowered.com/app/730/CS2/',
      );
      expect(result).toEqual([730]);
    });
  });

  describe('non-store URLs ignored', () => {
    it('ignores Steam community URLs', () => {
      const result = parseSteamAppIds('https://steamcommunity.com/app/730');
      expect(result).toEqual([]);
    });

    it('ignores Steam CDN or media URLs', () => {
      const result = parseSteamAppIds(
        'https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg',
      );
      expect(result).toEqual([]);
    });

    it('ignores Steam store URLs that are not /app/ paths', () => {
      const result = parseSteamAppIds(
        'https://store.steampowered.com/wishlist/profiles/12345',
      );
      expect(result).toEqual([]);
    });

    it('ignores Steam store bundle URLs', () => {
      const result = parseSteamAppIds(
        'https://store.steampowered.com/bundle/232/CS2_Bundle/',
      );
      expect(result).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles URL embedded in angle brackets (Discord auto-embed suppression)', () => {
      const result = parseSteamAppIds(
        '<https://store.steampowered.com/app/730/CS2/>',
      );
      expect(result).toEqual([730]);
    });

    it('handles URL with query parameters', () => {
      const result = parseSteamAppIds(
        'https://store.steampowered.com/app/730/CS2/?snr=1_5_9__205',
      );
      expect(result).toEqual([730]);
    });

    it('handles mixed content with Steam and non-Steam URLs', () => {
      const content =
        'Check https://store.steampowered.com/app/730/CS2/ and also https://example.com/other-thing';

      const result = parseSteamAppIds(content);
      expect(result).toEqual([730]);
    });

    it('handles URL with www subdomain prefix', () => {
      // Some users may paste www.store.steampowered.com — we only match store.steampowered.com
      const result = parseSteamAppIds(
        'https://www.store.steampowered.com/app/730/CS2/',
      );
      // www.store. is not the canonical form — this should NOT match
      expect(result).toEqual([]);
    });
  });
});

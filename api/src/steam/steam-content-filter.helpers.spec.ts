import { checkAdultContent } from './steam-content-filter.helpers';
import { ADULT_THEME_IDS } from '../igdb/igdb.constants';

describe('checkAdultContent', () => {
  describe('ITAD mature flag', () => {
    it('returns isAdult=true when ITAD mature flag is set', () => {
      const result = checkAdultContent('Normal Game', true);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toBe('ITAD mature flag');
    });

    it('prioritizes ITAD mature flag over other checks', () => {
      const result = checkAdultContent('Normal Game', true, [1, 2, 3]);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toBe('ITAD mature flag');
    });
  });

  describe('keyword blocklist', () => {
    it.each([
      'hentai',
      'porn',
      'xxx',
      'nsfw',
      'erotic',
      'lewd',
      'nude',
      'naked',
    ])('returns isAdult=true when name contains "%s"', (keyword) => {
      const result = checkAdultContent(`Some ${keyword} Game`, false);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toContain('keyword');
      expect(result.reason).toContain(keyword);
    });

    it('matches keywords case-insensitively', () => {
      const result = checkAdultContent('HENTAI Warriors', false);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toContain('hentai');
    });

    it('matches keywords as substrings', () => {
      const result = checkAdultContent('SuperNudeBeach', false);

      expect(result.isAdult).toBe(true);
    });
  });

  describe('IGDB adult themes', () => {
    it('returns isAdult=true for erotic theme (42)', () => {
      const result = checkAdultContent('Normal Game', false, [42]);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toBe('IGDB adult theme');
    });

    it('returns isAdult=true for sexual content theme (39)', () => {
      const result = checkAdultContent('Normal Game', false, [39]);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toBe('IGDB adult theme');
    });

    it('detects adult theme among non-adult themes', () => {
      const result = checkAdultContent('Normal Game', false, [1, 2, 42, 10]);

      expect(result.isAdult).toBe(true);
      expect(result.reason).toBe('IGDB adult theme');
    });

    it('uses ADULT_THEME_IDS constant for detection', () => {
      // Verify both known adult theme IDs are checked
      for (const themeId of ADULT_THEME_IDS) {
        const result = checkAdultContent('Normal Game', false, [themeId]);
        expect(result.isAdult).toBe(true);
      }
    });
  });

  describe('non-adult games', () => {
    it('returns isAdult=false for a normal game', () => {
      const result = checkAdultContent('Elden Ring', false);

      expect(result.isAdult).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('returns isAdult=false with safe IGDB themes', () => {
      const result = checkAdultContent('Elden Ring', false, [1, 2, 10]);

      expect(result.isAdult).toBe(false);
    });

    it('returns isAdult=false when igdbThemes is undefined', () => {
      const result = checkAdultContent('Elden Ring', false, undefined);

      expect(result.isAdult).toBe(false);
    });

    it('returns isAdult=false when igdbThemes is empty', () => {
      const result = checkAdultContent('Elden Ring', false, []);

      expect(result.isAdult).toBe(false);
    });
  });
});

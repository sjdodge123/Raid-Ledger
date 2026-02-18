import { parseNaturalTime, toDiscordTimestamp } from './time-parser';

describe('time-parser', () => {
  describe('parseNaturalTime', () => {
    it('should parse a simple future time', () => {
      // Use a time far in the future so it never becomes "past"
      const result = parseNaturalTime('December 25, 2030 8:00pm', 'UTC');
      expect(result).not.toBeNull();
      expect(result!.date.getFullYear()).toBe(2030);
      expect(result!.date.getMonth()).toBe(11); // December = 11
      expect(result!.timezone).toBe('UTC');
    });

    it('should return null for unparseable input', () => {
      const result = parseNaturalTime('not a time at all xyz', 'UTC');
      expect(result).toBeNull();
    });

    it('should return null for dates in the past', () => {
      const result = parseNaturalTime('January 1, 2020 8:00pm', 'UTC');
      expect(result).toBeNull();
    });

    it('should use UTC as default timezone when none provided', () => {
      const result = parseNaturalTime('December 25, 2030 8:00pm');
      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('UTC');
    });

    it('should preserve the provided timezone', () => {
      const result = parseNaturalTime(
        'December 25, 2030 8:00pm',
        'America/New_York',
      );
      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('America/New_York');
    });

    it('should store the original input text', () => {
      const input = 'December 25, 2030 8:00pm';
      const result = parseNaturalTime(input, 'UTC');
      expect(result).not.toBeNull();
      expect(result!.inputText).toBe(input);
    });
  });

  describe('toDiscordTimestamp', () => {
    it('should format a date as Discord full timestamp', () => {
      const date = new Date('2030-12-25T20:00:00Z');
      const result = toDiscordTimestamp(date, 'F');
      const epoch = Math.floor(date.getTime() / 1000);
      expect(result).toBe(`<t:${epoch}:F>`);
    });

    it('should default to F (full) style', () => {
      const date = new Date('2030-12-25T20:00:00Z');
      const result = toDiscordTimestamp(date);
      expect(result).toContain(':F>');
    });

    it('should support relative style', () => {
      const date = new Date('2030-12-25T20:00:00Z');
      const result = toDiscordTimestamp(date, 'R');
      expect(result).toContain(':R>');
    });
  });
});

import { sanitizeOutput } from './output-sanitizer';

describe('output-sanitizer', () => {
  it('returns normal text unchanged', () => {
    expect(sanitizeOutput('The raid starts at 8 PM.')).toBe(
      'The raid starts at 8 PM.',
    );
  });

  it('strips @everyone mentions', () => {
    expect(sanitizeOutput('Hello @everyone!')).toBe('Hello !');
  });

  it('strips @here mentions', () => {
    expect(sanitizeOutput('Hey @here check this out')).toBe(
      'Hey check this out',
    );
  });

  it('strips Discord invite URLs', () => {
    const text = 'Join us at https://discord.gg/abc123 for the raid';
    const result = sanitizeOutput(text);
    expect(result).not.toContain('discord.gg');
  });

  it('enforces max length when specified', () => {
    const long = 'a'.repeat(5000);
    const result = sanitizeOutput(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('uses default max length of 2000', () => {
    const long = 'a'.repeat(3000);
    const result = sanitizeOutput(long);
    expect(result.length).toBeLessThanOrEqual(2000);
  });
});

// — Adversarial tests —

describe('output-sanitizer (adversarial)', () => {
  describe('Discord mention stripping', () => {
    it('strips multiple @everyone occurrences in one string', () => {
      const result = sanitizeOutput('@everyone @everyone raid tonight');
      expect(result).not.toContain('@everyone');
    });

    it('strips multiple @here occurrences in one string', () => {
      const result = sanitizeOutput('@here and @here again');
      expect(result).not.toContain('@here');
    });

    it('strips mixed @everyone and @here in same output', () => {
      const result = sanitizeOutput('@everyone look at @here this');
      expect(result).not.toContain('@everyone');
      expect(result).not.toContain('@here');
    });

    it('strips discord.com/invite URL', () => {
      const result = sanitizeOutput('Come join https://discord.com/invite/xyz789 us');
      expect(result).not.toContain('discord.com/invite');
    });

    it('strips http (non-https) discord.gg URL', () => {
      const result = sanitizeOutput('Old link: http://discord.gg/oldlink');
      expect(result).not.toContain('discord.gg');
    });

    it('strips discord invite URL embedded mid-sentence without trailing space', () => {
      const result = sanitizeOutput('Go here:https://discord.gg/abc123end');
      expect(result).not.toContain('discord.gg');
    });

    it('collapses double spaces left after stripping @everyone', () => {
      const result = sanitizeOutput('Say @everyone now');
      expect(result).not.toMatch(/\s{2,}/);
    });
  });

  describe('length cap edge cases', () => {
    it('does not truncate text exactly at the max length', () => {
      const text = 'a'.repeat(2000);
      const result = sanitizeOutput(text);
      expect(result.length).toBe(2000);
    });

    it('truncates text that is one character over the limit', () => {
      const text = 'a'.repeat(2001);
      const result = sanitizeOutput(text, 2000);
      expect(result.length).toBe(2000);
    });

    it('does not truncate text shorter than max length', () => {
      const text = 'Hello raid!';
      const result = sanitizeOutput(text, 2000);
      expect(result).toBe('Hello raid!');
    });

    it('handles maxLength of 0 and returns empty string', () => {
      const result = sanitizeOutput('some text', 0);
      expect(result).toBe('');
    });

    it('truncation happens after stripping patterns', () => {
      // A string of 10 @everyone will become shorter after stripping,
      // and then length cap is applied to the stripped version
      const text = '@everyone'.repeat(10) + 'a'.repeat(2000);
      const result = sanitizeOutput(text, 100);
      expect(result).not.toContain('@everyone');
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });

  describe('edge inputs', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeOutput('')).toBe('');
    });

    it('trims leading/trailing whitespace from output', () => {
      const result = sanitizeOutput('  hello  ');
      expect(result).toBe('hello');
    });

    it('handles input that is only whitespace', () => {
      expect(sanitizeOutput('   ')).toBe('');
    });

    it('handles input where only Discord mention remains after stripping', () => {
      const result = sanitizeOutput('@everyone');
      expect(result).toBe('');
    });
  });
});

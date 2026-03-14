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

import {
  formatEpoch,
  stripDiscordMarkup,
  buildPlaintextContent,
} from './format-helpers';

describe('formatEpoch', () => {
  it('formats a known Unix epoch into a short date string', () => {
    // 1700000000 = Wed Nov 14, 2023
    const result = formatEpoch(1700000000);
    expect(result).toContain('Nov');
    expect(result).toContain('14');
  });

  it('returns a string for epoch 0 (Unix epoch start)', () => {
    const result = formatEpoch(0);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats a future epoch correctly', () => {
    const epoch = Math.floor(new Date('2026-04-01T20:00:00Z').getTime() / 1000);
    const result = formatEpoch(epoch);
    expect(result).toContain('Apr');
    expect(result).toContain('1');
  });
});

describe('stripDiscordMarkup', () => {
  it('replaces Discord timestamp tokens with formatted dates', () => {
    const result = stripDiscordMarkup('Event at <t:1700000000:f>');
    expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    expect(result).toContain('Nov');
  });

  it('replaces bare timestamp tokens (no style letter)', () => {
    const result = stripDiscordMarkup('Event at <t:1700000000>');
    expect(result).not.toMatch(/<t:\d+>/);
    expect(result).toContain('Nov');
  });

  it('replaces channel mentions with #channel', () => {
    expect(stripDiscordMarkup('Go to <#123456789>')).toBe('Go to #channel');
  });

  it('replaces role mentions with @role', () => {
    expect(stripDiscordMarkup('Hey <@&999888777>')).toBe('Hey @role');
  });

  it('replaces user mentions with @user', () => {
    expect(stripDiscordMarkup('<@123456789> left')).toBe('@user left');
  });

  it('replaces user mentions with ! prefix', () => {
    expect(stripDiscordMarkup('<@!123456789> left')).toBe('@user left');
  });

  it('strips bold markdown', () => {
    expect(stripDiscordMarkup('**Bold text**')).toBe('Bold text');
  });

  it('strips italic markdown', () => {
    expect(stripDiscordMarkup('*italic*')).toBe('italic');
  });

  it('removes empty parentheses', () => {
    expect(stripDiscordMarkup('Value ()')).toBe('Value ');
  });

  it('removes parentheses with only whitespace', () => {
    expect(stripDiscordMarkup('Value (   )')).toBe('Value ');
  });

  it('collapses multiple spaces', () => {
    expect(stripDiscordMarkup('a  b   c')).toBe('a b c');
  });

  it('handles multiple markup types in one string', () => {
    const input = '**Bold** in <#123> at <t:1700000000:R>';
    const result = stripDiscordMarkup(input);
    expect(result).not.toContain('**');
    expect(result).not.toMatch(/<#\d+>/);
    expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
  });
});

describe('buildPlaintextContent', () => {
  it('combines title and message with newline', () => {
    expect(buildPlaintextContent('Hello', 'World')).toBe('Hello\nWorld');
  });

  it('truncates content exceeding 150 characters', () => {
    const longTitle = 'A'.repeat(80);
    const longMessage = 'B'.repeat(100);
    const result = buildPlaintextContent(longTitle, longMessage);
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result).toMatch(/\.\.\.$/);
  });

  it('does not truncate short content', () => {
    const result = buildPlaintextContent('Short', 'Message');
    expect(result).toBe('Short\nMessage');
  });

  it('handles null/undefined title gracefully', () => {
    const result = buildPlaintextContent(
      null as unknown as string,
      'Some message',
    );
    expect(result).not.toContain('null');
    expect(result).toContain('Some message');
  });

  it('handles undefined message gracefully', () => {
    const result = buildPlaintextContent(
      'Title',
      undefined as unknown as string,
    );
    expect(result).not.toContain('undefined');
    expect(result).toContain('Title');
  });

  it('handles object values without showing [object Object]', () => {
    const result = buildPlaintextContent('Title', {
      key: 'val',
    } as unknown as string);
    expect(result).not.toContain('[object Object]');
  });
});

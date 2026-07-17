import {
  formatEpoch,
  formatRelativeEpoch,
  stripDiscordMarkup,
  buildPlaintextContent,
} from './format-helpers';

// epoch 1700000000 = 2023-11-14T22:13:20Z (Nov 14 is EST, not EDT).
const KNOWN_EPOCH = 1700000000;

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

describe('formatEpoch — timezone (ROK-1403)', () => {
  it('renders in the given IANA timezone', () => {
    const result = formatEpoch(KNOWN_EPOCH, 'America/New_York');
    expect(result).toContain('5:13 PM EST');
    expect(result).toContain('Nov 14');
  });

  it('renders a different wall-clock time for a different timezone', () => {
    const la = formatEpoch(KNOWN_EPOCH, 'America/Los_Angeles');
    expect(la).toContain('2:13 PM PST');
  });

  it('falls back to a correctly-labeled UTC rendering on a bad timezone', () => {
    const result = formatEpoch(KNOWN_EPOCH, 'Not/AZone');
    expect(result).toContain('UTC');
    expect(result).toContain('Nov 14');
  });

  it('renders in UTC when explicitly asked', () => {
    expect(formatEpoch(KNOWN_EPOCH, 'UTC')).toContain('10:13 PM UTC');
  });
});

describe('formatRelativeEpoch (ROK-1403)', () => {
  it('renders a future epoch as "in N …"', () => {
    const now = Date.parse('2026-07-15T12:00:00Z');
    const epoch = Math.floor((now + 2 * 3600 * 1000) / 1000);
    expect(formatRelativeEpoch(epoch, now)).toBe('in 2 hours');
  });

  it('renders a past epoch as "N … ago"', () => {
    const now = Date.parse('2026-07-15T12:00:00Z');
    const epoch = Math.floor((now - 3 * 86400 * 1000) / 1000);
    expect(formatRelativeEpoch(epoch, now)).toBe('3 days ago');
  });

  it('renders the current instant as "now"', () => {
    const now = Date.parse('2026-07-15T12:00:00Z');
    expect(formatRelativeEpoch(Math.floor(now / 1000), now)).toBe('now');
  });

  it('rounds ±x.5-unit deltas symmetrically (past magnitude == future magnitude)', () => {
    const now = Date.parse('2026-07-15T12:00:00Z');
    const future = Math.floor((now + 5400 * 1000) / 1000); // +1.5h
    const past = Math.floor((now - 5400 * 1000) / 1000); // -1.5h
    expect(formatRelativeEpoch(future, now)).toBe('in 2 hours');
    expect(formatRelativeEpoch(past, now)).toBe('2 hours ago');
  });

  it('never throws on a non-finite epoch (Infinity)', () => {
    expect(
      formatRelativeEpoch(Infinity, Date.parse('2026-07-15T12:00:00Z')),
    ).toBe('Invalid date');
  });
});

describe('out-of-range epoch safety (ROK-1403)', () => {
  // A user-controlled event title like `<t:9999999999999:f>` reaches these
  // helpers verbatim. They must degrade gracefully, never throw.
  const HUGE = 9999999999999; // *1000 exceeds the max valid Date

  it('formatEpoch returns "Invalid Date" instead of throwing', () => {
    expect(() => formatEpoch(HUGE, 'UTC')).not.toThrow();
    expect(formatEpoch(HUGE, 'UTC')).toContain('Invalid Date');
  });

  it('stripDiscordMarkup renders an out-of-range token without throwing', () => {
    const result = stripDiscordMarkup(`When: <t:${HUGE}:f>`, 'UTC');
    expect(result).not.toMatch(/<t:\d+/);
    expect(result).toContain('Invalid Date');
  });
});

describe('stripDiscordMarkup — timezone + relative (ROK-1403)', () => {
  it('renders an absolute :f token in the recipient timezone', () => {
    const result = stripDiscordMarkup(
      `At <t:${KNOWN_EPOCH}:f>`,
      'America/New_York',
    );
    expect(result).toContain('5:13 PM EST');
    expect(result).not.toMatch(/<t:\d+/);
  });

  it('renders :R as a relative delta and the absolute exactly once (no duplicate)', () => {
    // The exact bug: `<t:E:f> (<t:E:R>)` used to collapse to "ABS (ABS)".
    // Use a real ~2h-future epoch so the internal Date.now()-based relative
    // ("in 2 hours") and the test's absolute share the same baseline.
    const epoch = Math.floor(Date.now() / 1000) + 2 * 3600;
    const abs = formatEpoch(epoch, 'UTC');
    const result = stripDiscordMarkup(
      `Starts <t:${epoch}:f> (<t:${epoch}:R>)`,
      'UTC',
    );
    expect(result).not.toMatch(/<t:\d+/);
    expect(result).toMatch(/in \d+ hours?/); // :R rendered as a relative delta
    // The absolute appears exactly once — not the old "ABS (ABS)" duplicate.
    expect(result.split(abs).length - 1).toBe(1);
    expect(result).not.toContain(`${abs} (${abs})`);
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

// ── Moved from discord-notification.processor.spec.ts (ROK-1354 file-size
// split): buildPlaintextContent is a format-helpers export, so its DM
// plaintext suites (ROK-756/822/918) live here with the other pure-function
// format-helper tests. ──
describe('buildPlaintextContent', () => {
  it('combines title and message with newline', () => {
    expect(buildPlaintextContent('Hello', 'World')).toBe('Hello\nWorld');
  });

  it('produces clean output for typical notification data', () => {
    const result = buildPlaintextContent(
      'Event Starting in 15 Minutes!',
      'Raid Night starts in 15 minutes at 8:00 PM EST.',
    );
    expect(result).toBe(
      'Event Starting in 15 Minutes!\nRaid Night starts in 15 minutes at 8:00 PM EST.',
    );
    expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    expect(result).not.toMatch(/<#\d+>/);
  });

  describe('ROK-822 — Discord markup stripping', () => {
    it('strips bold markdown from message', () => {
      const result = buildPlaintextContent(
        'Event Reminder',
        'Your event **Raid Night** started 5 minutes ago',
      );
      expect(result).toBe(
        'Event Reminder\nYour event Raid Night started 5 minutes ago',
      );
    });

    it('strips italic markdown from message', () => {
      const result = buildPlaintextContent(
        'Update',
        'Check *your profile* for details',
      );
      expect(result).not.toContain('*');
    });

    it('strips channel mention markup <#channelId>', () => {
      const result = buildPlaintextContent(
        'Join Now',
        'Head to <#123456789012345678> for the event',
      );
      expect(result).not.toMatch(/<#\d+>/);
      expect(result).toBe('Join Now\nHead to #channel for the event');
    });

    it('strips user mention markup <@userId>', () => {
      const result = buildPlaintextContent(
        'Roster Update',
        '<@987654321012345678> left the roster',
      );
      expect(result).not.toMatch(/<@!?\d+>/);
      expect(result).toBe('Roster Update\n@user left the roster');
    });

    it('strips role mention markup <@&roleId>', () => {
      const result = buildPlaintextContent(
        'Alert',
        'Attention <@&111222333444555666> members',
      );
      expect(result).not.toMatch(/<@&\d+>/);
      expect(result).toBe('Alert\nAttention @role members');
    });

    it('replaces timestamp markup with formatted date (ROK-918)', () => {
      const result = buildPlaintextContent(
        'Reminder',
        'Event starts <t:1700000000:R> at <t:1700000000:F>',
      );
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
      // Epoch 1700000000 = Nov 14, 2023 — should contain formatted date
      expect(result).toContain('Nov 14');
    });

    it('replaces bare timestamp markup with formatted date (ROK-918)', () => {
      const result = buildPlaintextContent(
        'Reminder',
        'Event starts <t:1700000000>',
      );
      expect(result).not.toMatch(/<t:\d+>/);
      expect(result).toContain('Nov 14');
    });
  });

  describe('ROK-822 — null/undefined/object safety', () => {
    it('replaces undefined title with empty string', () => {
      const result = buildPlaintextContent(
        undefined as unknown as string,
        'Some message',
      );
      expect(result).not.toContain('undefined');
      expect(result).toContain('Some message');
    });

    it('replaces null title with empty string', () => {
      const result = buildPlaintextContent(
        null as unknown as string,
        'Some message',
      );
      expect(result).not.toContain('null');
      expect(result).toContain('Some message');
    });

    it('replaces undefined message with empty string', () => {
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

    it('handles numeric values gracefully', () => {
      const result = buildPlaintextContent('Title', 42 as unknown as string);
      expect(result).not.toContain('[object');
      expect(result).toContain('Title');
    });
  });

  describe('ROK-822 — length constraint', () => {
    it('truncates content exceeding 150 characters', () => {
      const longTitle = 'A'.repeat(80);
      const longMessage = 'B'.repeat(100);
      const result = buildPlaintextContent(longTitle, longMessage);
      expect(result.length).toBeLessThanOrEqual(150);
    });

    it('appends ellipsis when truncated', () => {
      const longTitle = 'A'.repeat(80);
      const longMessage = 'B'.repeat(100);
      const result = buildPlaintextContent(longTitle, longMessage);
      expect(result).toMatch(/\.\.\.$/);
    });

    it('does not truncate short content', () => {
      const result = buildPlaintextContent('Short', 'Message');
      expect(result).toBe('Short\nMessage');
      expect(result).not.toMatch(/\.\.\.$/);
    });
  });

  describe('ROK-822 — multiple markup patterns combined', () => {
    it('strips all markup types from a single message', () => {
      const result = buildPlaintextContent(
        'Event Update',
        '**Raid Night** moved to <#123456789> starting <t:1700000000:R>',
      );
      expect(result).not.toContain('**');
      expect(result).not.toMatch(/<#\d+>/);
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    });

    it('collapses multiple spaces after stripping', () => {
      const result = buildPlaintextContent('Title', 'Go to  <#123>  now');
      expect(result).not.toContain('  ');
    });
  });

  describe('ROK-918 — reschedule DM plaintext date', () => {
    it('replaces Discord timestamps with readable dates in reschedule messages', () => {
      // Simulates the real reschedule DM format from event-lifecycle.helpers.ts:
      // `"${title}" has been rescheduled to <t:EPOCH:f> (<t:EPOCH:R>)`
      const epoch = Math.floor(
        new Date('2026-04-01T20:00:00Z').getTime() / 1000,
      );
      const message = `"Raid Night" has been rescheduled to <t:${epoch}:f> (<t:${epoch}:R>)`;
      const result = buildPlaintextContent('Event Rescheduled', message);
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
      expect(result).not.toContain('()');
      expect(result).toContain('Apr 1');
      expect(result).toContain('rescheduled');
    });

    it('collapses empty parentheses left after timestamp removal', () => {
      const result = buildPlaintextContent('Title', 'Moved to  ()');
      expect(result).not.toContain('()');
    });

    it('does not collapse parentheses with content', () => {
      const result = buildPlaintextContent('Title', 'Moved to (tomorrow)');
      expect(result).toContain('(tomorrow)');
    });

    it('replaces both timestamps so neither raw token remains', () => {
      // Both <t:EPOCH:f> and <t:EPOCH:R> must be replaced — not just one
      const epoch = Math.floor(
        new Date('2026-06-15T18:00:00Z').getTime() / 1000,
      );
      const message = `Starts <t:${epoch}:f> (in <t:${epoch}:R>)`;
      const result = buildPlaintextContent('Update', message);
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    });

    it('handles parentheses with only whitespace as empty (collapses them)', () => {
      const result = buildPlaintextContent('Title', 'Event at (   )');
      expect(result).not.toMatch(/\(\s*\)/);
    });

    it('formats epoch=0 without crashing (Unix epoch)', () => {
      const result = buildPlaintextContent('Title', 'Since <t:0:f>');
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
      expect(typeof result).toBe('string');
    });

    it('produces correct date for a known epoch value', () => {
      // 1700000000 seconds = Wed Nov 14, 2023
      const result = buildPlaintextContent(
        'Reminder',
        'Event at <t:1700000000:f>',
      );
      expect(result).toContain('Nov 14');
    });

    it('still strips bold and channel after timestamps are replaced', () => {
      const epoch = Math.floor(
        new Date('2026-05-01T12:00:00Z').getTime() / 1000,
      );
      const message = `**Bold text** in <#999888777666555444> at <t:${epoch}:f>`;
      const result = buildPlaintextContent('Title', message);
      expect(result).not.toContain('**');
      expect(result).not.toMatch(/<#\d+>/);
      expect(result).not.toMatch(/<t:\d+:[a-zA-Z]>/);
    });
  });
});

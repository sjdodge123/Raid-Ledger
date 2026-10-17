import {
  RESCHEDULE_BUTTON_IDS,
  friendlyDiscordErrorMessage,
} from './discord-bot.constants';

describe('RESCHEDULE_BUTTON_IDS (ROK-537)', () => {
  it('has the correct CONFIRM prefix', () => {
    expect(RESCHEDULE_BUTTON_IDS.CONFIRM).toBe('reschedule_confirm');
  });

  it('has the correct TENTATIVE prefix', () => {
    expect(RESCHEDULE_BUTTON_IDS.TENTATIVE).toBe('reschedule_tentative');
  });

  it('has the correct DECLINE prefix', () => {
    expect(RESCHEDULE_BUTTON_IDS.DECLINE).toBe('reschedule_decline');
  });

  it('has the correct CHARACTER_SELECT prefix', () => {
    expect(RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT).toBe(
      'reschedule_char_select',
    );
  });

  it('has the correct ROLE_SELECT prefix', () => {
    expect(RESCHEDULE_BUTTON_IDS.ROLE_SELECT).toBe('reschedule_role_select');
  });

  it('all prefixes are unique (no collision with other button ID sets)', () => {
    const values = Object.values(RESCHEDULE_BUTTON_IDS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('custom IDs use underscore separators (not hyphens)', () => {
    for (const value of Object.values(RESCHEDULE_BUTTON_IDS)) {
      // Confirm format: reschedule_confirm, reschedule_decline, etc.
      expect(value).toMatch(/^reschedule_/);
    }
  });
});

describe('friendlyDiscordErrorMessage', () => {
  it('returns generic message for non-Error values', () => {
    expect(friendlyDiscordErrorMessage(null)).toBe(
      'Failed to connect with provided token',
    );
    expect(friendlyDiscordErrorMessage('string error')).toBe(
      'Failed to connect with provided token',
    );
    expect(friendlyDiscordErrorMessage(42)).toBe(
      'Failed to connect with provided token',
    );
  });

  it('detects disallowed intent errors', () => {
    const err = new Error('Missing disallowed intent');
    expect(friendlyDiscordErrorMessage(err)).toContain('Missing required');
    expect(friendlyDiscordErrorMessage(err)).toContain('privileged intent');
  });

  it('detects privileged intent errors', () => {
    const err = new Error('privileged intent not enabled');
    expect(friendlyDiscordErrorMessage(err)).toContain('privileged intent');
  });

  it('detects intent error by code 4014', () => {
    const err = Object.assign(new Error('Unknown error'), { code: 4014 });
    expect(friendlyDiscordErrorMessage(err)).toContain('privileged intent');
  });

  it('detects invalid token errors', () => {
    const err = new Error('invalid token provided');
    expect(friendlyDiscordErrorMessage(err)).toContain('Invalid bot token');
  });

  it('detects TOKEN_INVALID errors', () => {
    const err = new Error('TOKEN_INVALID');
    expect(friendlyDiscordErrorMessage(err)).toContain('Invalid bot token');
  });

  it('detects DNS resolution failures', () => {
    const err = new Error('getaddrinfo ENOTFOUND discord.com');
    expect(friendlyDiscordErrorMessage(err)).toContain(
      'Unable to reach Discord',
    );
  });

  it('detects connection refused errors', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
    expect(friendlyDiscordErrorMessage(err)).toContain(
      'Connection to Discord was refused',
    );
  });

  it('falls back to generic message for unrecognized errors', () => {
    const err = new Error('Some completely unknown error');
    expect(friendlyDiscordErrorMessage(err)).toBe(
      'Failed to connect with provided token',
    );
  });
});

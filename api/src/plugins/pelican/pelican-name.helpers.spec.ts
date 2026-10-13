import { redactServerName } from './pelican-name.helpers';

describe('redactServerName (ruling Q3)', () => {
  it.each([
    ['Valheim 192.168.1.20', 'Valheim'],
    ['Valheim (10.0.0.5:2456)', 'Valheim'],
    ['MC - 203.0.113.9:25565', 'MC'],
    ['Rust [2001:db8::1]:28015', 'Rust'],
    ['Rust 2001:db8:85a3:0:0:8a2e:370:7334', 'Rust'],
    ['Ark fe80::1ff:fe23:4567:890a', 'Ark'],
    ['Ark ::1', 'Ark'],
    ['Palworld @ play.example.com:8211', 'Palworld'],
    ['Factorio localhost:34197', 'Factorio'],
    ['Join https://panel.example.com/server/abc', 'Join'],
    ['Terraria 1a2b3c4d-0000-4000-8000-1a2b3c4d5e6f', 'Terraria'],
    ['Terraria 1a2b3c4d', 'Terraria'],
    ['Valheim nas:2456', 'Valheim'],
    ['CS (myserver:27015)', 'CS'],
    ['mc:25565 Survival', 'Survival'],
  ])('%s -> %s', (raw, expected) => {
    expect(redactServerName(raw, 1)).toBe(expected);
  });

  it.each([
    'Valheim Main',
    'Season 2: Hardcore',
    'Raid night 12:30',
    'deadbeef',
    'Build 20251013',
    'Valheim: Season 2',
    // A time keeps: the host label of `host:port` must contain a letter.
    'Raid 10:30',
    // Not a full 8-group IPv6 address, so not redacted.
    'Score a:b:c:d',
  ])('keeps a clean name intact: %s', (raw) => {
    expect(redactServerName(raw, 1)).toBe(raw);
  });

  it('falls back to "Server <id>" when nothing survives', () => {
    expect(redactServerName('10.0.0.5:2456', 42)).toBe('Server 42');
    expect(redactServerName('   ', 9)).toBe('Server 9');
  });

  it('never emits more than 200 characters', () => {
    expect(redactServerName('x'.repeat(500), 1)).toHaveLength(200);
  });
});

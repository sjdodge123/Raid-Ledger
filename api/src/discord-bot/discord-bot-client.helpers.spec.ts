import { PermissionsBitField, type Guild } from 'discord.js';
import {
  REQUIRED_PERMISSIONS,
  botInvitePermissionsBits,
  buildBotInviteUrl,
  checkBotPermissions,
} from './discord-bot-client.helpers';

describe('REQUIRED_PERMISSIONS (ROK-313 AC13)', () => {
  it('includes the Kick Members permission', () => {
    expect(
      REQUIRED_PERMISSIONS.some(
        (p) => p.flag === PermissionsBitField.Flags.KickMembers,
      ),
    ).toBe(true);
  });
});

/**
 * ROK-1471 AC11/AC12 — the invite URL is DERIVED from REQUIRED_PERMISSIONS.
 * The permission integers below appear ONLY here (and in comments): AC15
 * forbids them in source. D14a's guard spec enforces that.
 */
describe('botInvitePermissionsBits (ROK-1471 AC11)', () => {
  // T17 (R): a throwaway 18th entry must move the number. A hardcoded
  // constant cannot satisfy this — the expectation is recomputed, not literal.
  it('changes when a permission is appended, matching the recomputed OR', () => {
    const extended = [
      ...REQUIRED_PERMISSIONS,
      { label: 'Throwaway', flag: PermissionsBitField.Flags.MuteMembers },
    ];

    const base = botInvitePermissionsBits(REQUIRED_PERMISSIONS);
    const grown = botInvitePermissionsBits(extended);
    const recomputed = extended.reduce((acc, p) => acc | p.flag, 0n);

    expect(grown).not.toBe(base);
    expect(grown).toBe(recomputed);
    // Parsed, not substring-matched: `permissions` is the LAST query param, so
    // `not.toContain('permissions=<base>&')` could never fail — it passed for
    // every possible implementation, including a hardcoded constant.
    const permissions = new URL(
      buildBotInviteUrl('123', extended),
    ).searchParams.get('permissions');

    expect(permissions).toBe(recomputed.toString());
    expect(permissions).not.toBe(base.toString());
  });

  // T18: today's 17 entries. The near-miss value is the same set MINUS
  // `Connect` (bit 20, 1048576) — the value recorded against the fleet slot
  // bots before the voice permission was added. Asserting both directions
  // catches a silently dropped flag as well as a silently added one.
  it('derives the current 17-permission bitfield', () => {
    expect(REQUIRED_PERMISSIONS).toHaveLength(17);
    expect(botInvitePermissionsBits().toString()).toBe('589674583247891');
    expect(botInvitePermissionsBits().toString()).not.toBe('589674582199315');
  });

  it('is the OR of every declared flag, order-independent', () => {
    const reversed = [...REQUIRED_PERMISSIONS].reverse();
    expect(botInvitePermissionsBits(reversed)).toBe(botInvitePermissionsBits());
  });
});

describe('buildBotInviteUrl (ROK-1471 AC11)', () => {
  it('uses the supplied client id and the bot + commands scopes', () => {
    const url = buildBotInviteUrl('987654321');

    expect(url).toBe(
      'https://discord.com/oauth2/authorize?client_id=987654321' +
        '&scope=bot%20applications.commands' +
        `&permissions=${botInvitePermissionsBits().toString()}`,
    );
  });

  it('does not leak a different client id', () => {
    expect(buildBotInviteUrl('111')).toContain('client_id=111');
    expect(buildBotInviteUrl('222')).toContain('client_id=222');
  });
});

describe('checkBotPermissions (ROK-1471 AC12)', () => {
  const guild = {
    members: { me: { permissions: { has: (): boolean => true } } },
  } as unknown as Guild;

  it('reports every required permission, including the thread trio', () => {
    const results = checkBotPermissions(guild);

    expect(results).toHaveLength(17);
    const names = results.map((r) => r.name);
    expect(names).toContain('Manage Threads');
    expect(names).toContain('Create Public Threads');
    expect(names).toContain('Send Messages in Threads');
    expect(results.every((r) => r.granted)).toBe(true);
  });

  it('marks everything ungranted when the bot is not in the guild', () => {
    const results = checkBotPermissions(null);
    expect(results).toHaveLength(17);
    expect(results.every((r) => !r.granted)).toBe(true);
  });
});

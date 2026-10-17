/**
 * ROK-1627 — the post-claim DM omits the event link when no client URL is
 * configured, rather than printing a localhost one.
 */
import { assertClaimerIsInvitee, buildPostClaimDm } from './invite.helpers';

describe('buildPostClaimDm', () => {
  it('includes the event link when a client URL is configured', () => {
    const message = buildPostClaimDm(
      'Mythic Raid Night',
      42,
      'https://raid.example.com',
    );
    expect(message).toContain('You have joined **Mythic Raid Night**!');
    expect(message).toContain(
      'View the event: https://raid.example.com/events/42',
    );
  });

  it('omits the link line entirely when no client URL is configured', () => {
    const message = buildPostClaimDm('Mythic Raid Night', 42, null);
    expect(message).toBe('You have joined **Mythic Raid Night**!');
    expect(message).not.toContain('View the event');
    expect(message).not.toContain('localhost');
  });
});

describe('assertClaimerIsInvitee (ROK-1825)', () => {
  it('rejects a claimer who is not the Discord user the slot was made for', () => {
    expect(() =>
      assertClaimerIsInvitee({ discordUserId: '555' }, 'local:x@test.local'),
    ).toThrow('This invite is reserved for another player');
    expect(() =>
      assertClaimerIsInvitee({ discordUserId: '555' }, null),
    ).toThrow('This invite is reserved for another player');
  });

  it('allows the invitee, and anyone when the slot names no Discord user', () => {
    expect(() =>
      assertClaimerIsInvitee({ discordUserId: '555' }, '555'),
    ).not.toThrow();
    expect(() =>
      assertClaimerIsInvitee({ discordUserId: null }, 'local:a'),
    ).not.toThrow();
  });
});

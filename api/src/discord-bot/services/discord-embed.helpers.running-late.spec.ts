/**
 * Tests for the "running late" (⏰) roster marker in embed mentions (ROK-1379).
 *
 * A running-late attendee is still attending, so the marker is an additive
 * prefix that composes with the tentative (⏳) marker and must NOT apply the
 * "left" strikethrough.
 */
import { getMentionsForRole } from './discord-embed.helpers';
import type { DiscordEmojiService } from './discord-emoji.service';

const CLOCK = '⏰';
const HOURGLASS = '⏳';

const mockEmojiService = {
  getRoleEmoji: jest.fn(() => ''),
  getClassEmoji: jest.fn(() => ''),
} as unknown as DiscordEmojiService;

function makeMention(
  discordId: string,
  overrides: Partial<{
    status: string | null;
    runningLate: boolean | null;
  }> = {},
) {
  return {
    discordId,
    username: `user-${discordId}`,
    role: null,
    preferredRoles: null,
    status: overrides.status ?? 'signed_up',
    runningLate: overrides.runningLate ?? null,
  };
}

describe('getMentionsForRole — running-late marker (ROK-1379)', () => {
  it('prefixes a running-late attendee with the ⏰ marker', () => {
    const result = getMentionsForRole(
      [makeMention('late-1', { runningLate: true })],
      null,
      mockEmojiService,
    );
    expect(result).toContain(CLOCK);
    expect(result).toContain('<@late-1>');
  });

  it('does not strike through a running-late attendee (still attending)', () => {
    const result = getMentionsForRole(
      [makeMention('late-2', { runningLate: true })],
      null,
      mockEmojiService,
    );
    expect(result).not.toContain('~~');
  });

  it('omits the ⏰ marker for an attendee who is not running late', () => {
    const result = getMentionsForRole(
      [makeMention('ontime-1', { runningLate: false })],
      null,
      mockEmojiService,
    );
    expect(result).not.toContain(CLOCK);
  });

  it('composes the ⏰ marker with the ⏳ tentative marker', () => {
    const result = getMentionsForRole(
      [makeMention('late-tent', { status: 'tentative', runningLate: true })],
      null,
      mockEmojiService,
    );
    expect(result).toContain(CLOCK);
    expect(result).toContain(HOURGLASS);
  });
});

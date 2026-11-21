import type { ReminderRosterMember } from '../../../discord-bot/discord-bot-client.guild.helpers';
import {
  isInsideJoinWait,
  reminderCandidateIds,
} from './signin-reminder.eligibility';

const DAY = 24 * 60 * 60 * 1000;
const LAUNCH = new Date('2026-11-01T00:00:00Z');
const NOW = new Date('2026-11-20T12:00:00Z');
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);

function member(
  discordId: string,
  joinedAt: Date | null,
  isBot = false,
): ReminderRosterMember {
  return { discordId, joinedAt, isBot };
}

describe('isInsideJoinWait (ruled Q3: 3 days after launch)', () => {
  it('members who joined before launch never wait, even if recent to launch', () => {
    expect(
      isInsideJoinWait(new Date('2026-10-31T23:00:00Z'), LAUNCH, NOW),
    ).toBe(false);
  });
  it('a post-launch joiner waits 3 days', () => {
    expect(isInsideJoinWait(ago(2), LAUNCH, NOW)).toBe(true);
    expect(isInsideJoinWait(ago(2.99), LAUNCH, NOW)).toBe(true);
    expect(isInsideJoinWait(ago(3), LAUNCH, NOW)).toBe(false);
    expect(isInsideJoinWait(ago(4), LAUNCH, NOW)).toBe(false);
  });
  it('an unknown join date is treated as a launch member', () => {
    expect(isInsideJoinWait(null, LAUNCH, NOW)).toBe(false);
  });
  it('on the launch tick itself everyone is due (backdated first wave)', () => {
    expect(isInsideJoinWait(ago(0.5), NOW, NOW)).toBe(false);
  });
});

describe('reminderCandidateIds', () => {
  it('drops bots and new joiners, keeps the rest once', () => {
    const roster = [
      member('human-old', ago(100)),
      member('bot', ago(100), true),
      member('new-2d', ago(2)),
      member('new-4d', ago(4)),
      member('human-old', ago(100)),
      member('no-date', null),
    ];
    expect(reminderCandidateIds(roster, LAUNCH, NOW)).toEqual([
      'human-old',
      'new-4d',
      'no-date',
    ]);
  });
});

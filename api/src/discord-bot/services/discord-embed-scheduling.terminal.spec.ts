/**
 * ROK-1549 (S1-AC3, S1-AC4) + ROK-1604 (S3-AC3) — terminal-card grammar and
 * the open poll's deadline line.
 *
 * - open + deadline → `Closes <t:UNIX:R> (<t:UNIX:f>)` directly above the link.
 * - cancelled       → `**Reason:** …` (escaped, 300-char cap) + `View poll ↗`.
 * - closed          → `Leading time was <t:…:f>` (only when a slot had votes),
 *                     the expired hint, `View poll ↗`.
 * Neither terminal card carries the tie rule or an action row.
 */
import { SLOT_TIE_RULE } from '@raid-ledger/contract';
import {
  buildSchedulingPollEmbedBody,
  schedulingPollAuthorLine,
} from './discord-embed-scheduling.helpers';
import type { EmbedContext } from './discord-embed.factory';
import type { SchedulingPollEmbedData } from './discord-embed-scheduling.types';

const POLL_URL = 'http://localhost:5173/community-lineup/1/schedule/10';
const EARLY = '2026-04-10T19:00:00.000Z';
const LATE = '2026-04-11T20:00:00.000Z';
const DEADLINE = '2026-04-09T12:00:00.000Z';
const EXPIRED_HINT =
  '*The deadline passed without a lock-in — start a new poll to pick a time.*';

const context: EmbedContext = {
  communityName: 'Test Guild',
  clientUrl: 'http://localhost:5173',
  timezone: 'America/New_York',
};

function unix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** A tied top pair, so a leaking tie-rule line would show up. */
function pollData(
  overrides: Partial<SchedulingPollEmbedData> = {},
): SchedulingPollEmbedData {
  return {
    matchId: 10,
    lineupId: 1,
    gameName: 'Elden Ring',
    pollUrl: POLL_URL,
    status: 'open',
    slots: [
      { id: 2, proposedTime: LATE, voteCount: 3, voterNames: ['Ana'] },
      { id: 1, proposedTime: EARLY, voteCount: 3, voterNames: ['Bo'] },
    ],
    uniqueVoterCount: 4,
    ...overrides,
  };
}

function render(overrides: Partial<SchedulingPollEmbedData> = {}) {
  return buildSchedulingPollEmbedBody(pollData(overrides), context);
}

function description(overrides: Partial<SchedulingPollEmbedData> = {}) {
  return render(overrides).toJSON().description ?? '';
}

function lines(overrides: Partial<SchedulingPollEmbedData> = {}): string[] {
  return description(overrides).split('\n');
}

describe('scheduling poll author line — terminal grammar', () => {
  it('cancelled reads POLL CANCELLED', () => {
    expect(schedulingPollAuthorLine(pollData({ status: 'cancelled' }))).toBe(
      '■ POLL CANCELLED',
    );
  });

  it('closed reads POLL EXPIRED', () => {
    expect(schedulingPollAuthorLine(pollData({ status: 'closed' }))).toBe(
      '■ POLL EXPIRED',
    );
  });
});

describe('open poll — deadline line (S1-AC3)', () => {
  it('renders relative + full timestamps directly above the vote link', () => {
    const rows = lines({ deadline: DEADLINE });
    const at = rows.indexOf(
      `Closes <t:${unix(DEADLINE)}:R> (<t:${unix(DEADLINE)}:f>)`,
    );
    expect(at).toBeGreaterThan(-1);
    expect(rows[at + 1]).toBe(`[Vote now ↗](${POLL_URL})`);
  });

  it('omits the line when the poll has no deadline', () => {
    expect(description({ deadline: null })).not.toContain('Closes');
  });

  it.each(['locked_in', 'cancelled', 'closed'] as const)(
    '%s never shows the deadline line',
    (status) => {
      expect(description({ status, deadline: DEADLINE })).not.toContain(
        'Closes',
      );
    },
  );

  it('keeps the tie rule on an open poll', () => {
    expect(description()).toContain(SLOT_TIE_RULE);
  });
});

describe('cancelled card — reason (S1-AC3)', () => {
  it('shows the reason and links "View poll"', () => {
    const desc = description({
      status: 'cancelled',
      cancelReason: 'Raid night moved',
    });
    expect(desc).toContain('**Reason:** Raid night moved');
    expect(desc.trimEnd().endsWith(`[View poll ↗](${POLL_URL})`)).toBe(true);
    expect(desc).not.toContain('Vote now');
  });

  it.each([null, undefined, '', '   '])(
    'omits the reason line when the reason is %p',
    (reason) => {
      const desc = description({ status: 'cancelled', cancelReason: reason });
      expect(desc).not.toContain('Reason');
      expect(desc).not.toContain('null');
    },
  );

  it('truncates a long reason to 300 chars with an ellipsis', () => {
    const desc = description({
      status: 'cancelled',
      cancelReason: 'a'.repeat(400),
    });
    expect(desc).toContain(`**Reason:** ${'a'.repeat(300)}…`);
    expect(desc).not.toContain('a'.repeat(301));
  });

  it('escapes Discord markdown so the reason cannot restyle or link', () => {
    const desc = description({
      status: 'cancelled',
      cancelReason: '**bold** _it_ `code` ||spoil|| [x](https://evil.example)',
    });
    expect(desc).toContain(
      '**Reason:** \\*\\*bold\\*\\* \\_it\\_ \\`code\\` \\|\\|spoil\\|\\| \\[x\\]\\(https://evil.example\\)',
    );
  });

  it('defangs a mention so a re-sync never pings', () => {
    const desc = description({
      status: 'cancelled',
      cancelReason: 'ask <@123>',
    });
    expect(desc).toContain('**Reason:** ask 123');
    expect(desc).not.toContain('<@123>');
  });

  it('keeps the slots but drops the tie rule', () => {
    const desc = description({ status: 'cancelled', cancelReason: 'x' });
    expect(desc).toContain(`<t:${unix(EARLY)}:f> — **3** votes`);
    expect(desc).not.toContain(SLOT_TIE_RULE);
  });
});

describe('expired card (S3-AC3)', () => {
  it('names the leading time, the hint, and links "View poll"', () => {
    const rows = lines({ status: 'closed' });
    expect(rows).toContain(`Leading time was <t:${unix(EARLY)}:f>`);
    expect(rows).toContain(EXPIRED_HINT);
    expect(rows[rows.length - 1]).toBe(`[View poll ↗](${POLL_URL})`);
    expect(rows.join('\n')).not.toContain('Vote now');
  });

  it('omits the leading time when no slot had votes', () => {
    const desc = description({
      status: 'closed',
      slots: [{ id: 1, proposedTime: EARLY, voteCount: 0, voterNames: [] }],
    });
    expect(desc).not.toContain('Leading time');
    expect(desc).toContain(EXPIRED_HINT);
  });

  it('omits the leading time when no times were suggested', () => {
    const desc = description({ status: 'closed', slots: [] });
    expect(desc).not.toContain('Leading time');
    expect(desc).toContain(EXPIRED_HINT);
  });

  it('carries no tie-rule line', () => {
    expect(description({ status: 'closed' })).not.toContain(SLOT_TIE_RULE);
  });
});

describe('terminal cards stop inviting votes (Q6)', () => {
  it.each(['cancelled', 'closed'] as const)(
    '%s drops the "vote for the best time" intro',
    (status) => {
      expect(description({ status })).not.toContain('Vote for the best time');
    },
  );
});

describe('locked-in card — body unchanged', () => {
  it('keeps the slot block and no terminal lines', () => {
    const desc = description({ status: 'locked_in', cancelReason: 'x' });
    expect(desc).not.toContain('Reason');
    expect(desc).not.toContain('Leading time');
  });

  // ROK-1607 AC3: the time is settled, so the card must not invite a vote.
  it('links "View poll ↗", never "Vote now"', () => {
    const desc = description({ status: 'locked_in' });
    expect(desc.trimEnd().endsWith(`[View poll ↗](${POLL_URL})`)).toBe(true);
    expect(desc).not.toContain('Vote now');
  });
});

// ROK-1607 AC3 — one assertion over EVERY terminal state, so a new ending
// cannot quietly ship with a vote invitation on it.
describe('no terminal card invites a vote (ROK-1607)', () => {
  it.each(['locked_in', 'cancelled', 'closed'] as const)(
    '%s offers "View poll ↗" and no "Vote now"',
    (status) => {
      const desc = description({ status });
      expect(desc).not.toContain('Vote now');
      expect(desc.trimEnd().endsWith(`[View poll ↗](${POLL_URL})`)).toBe(true);
    },
  );

  it('leaves the OPEN card saying "Vote now"', () => {
    const desc = description({ status: 'open' });
    expect(desc.trimEnd().endsWith(`[Vote now ↗](${POLL_URL})`)).toBe(true);
  });
});

/**
 * SchedulingSlotRow conflict-warning tooltip (ROK-1032).
 *
 * The poll grid already flagged conflicting slots ("⚠ conflicts", ROK-1031);
 * this pins the remaining AC — the warning surfaces the conflicting event
 * NAME (inline + in the hover `title` tooltip).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingSlotRow } from '../SchedulingSlotRow';

function makeSlot(): ScheduleSlotWithVotesDto {
  return {
    id: 1001,
    matchId: 500,
    proposedTime: '2030-07-01T20:00:00.000Z',
    overlapScore: 0,
    suggestedBy: 'user',
    createdAt: '2026-06-01T00:00:00.000Z',
    votes: [],
  } as ScheduleSlotWithVotesDto;
}

type RowOverrides = Partial<{
  voted: boolean;
  noVoted: boolean;
  readOnly: boolean;
  canVote: boolean;
  signedIn: boolean;
}>;

function renderRow(conflictEventNames: string[], overrides: RowOverrides = {}) {
  const {
    voted = false,
    noVoted = false,
    readOnly = false,
    canVote = true,
    signedIn = true,
  } = overrides;
  return renderWithProviders(
    <SchedulingSlotRow
      slot={makeSlot()}
      voted={voted}
      noVoted={noVoted}
      conflictEventNames={conflictEventNames}
      readOnly={readOnly}
      canVote={canVote}
      signedIn={signedIn}
      enrolByVoting={false}
      canLock={false}
      onToggleVote={vi.fn()}
      onToggleNo={vi.fn()}
      onLock={vi.fn()}
    />,
  );
}

/**
 * ROK-1546 AC3 supersedes the ROK-1032 tooltip: a `title` is invisible on
 * touch (no hover) and is not reliably announced, so "+2" told a mobile or
 * screen-reader user that something clashed but never what. Every conflicting
 * event is now visible text.
 */
describe('SchedulingSlotRow — conflict warning names (ROK-1032, ROK-1546 AC3)', () => {
  it('surfaces the conflicting event name as visible text', () => {
    renderRow(['Game Night']);
    const marker = screen.getByTestId('slot-conflicts');
    expect(marker).toBeVisible();
    expect(marker).toHaveTextContent('⚠ Conflicts with Game Night');
  });

  it('AC3 — names EVERY conflicting event inline, with no hidden overflow', () => {
    renderRow(['Game Night', 'Raid Night', 'Mythic+']);
    const marker = screen.getByTestId('slot-conflicts');
    expect(marker).toHaveTextContent(
      '⚠ Conflicts with Game Night, Raid Night and Mythic+',
    );
    // The names are the text, not a tooltip a touch device can never open.
    expect(marker).not.toHaveAttribute('title');
    expect(marker.textContent).not.toContain('+2');
    // Three names overflow a phone-width row — it must wrap, not clip.
    expect(marker.className).toContain('break-words');
  });

  it('joins exactly two conflicts with "and"', () => {
    renderRow(['Game Night', 'Raid Night']);
    expect(screen.getByTestId('slot-conflicts')).toHaveTextContent(
      '⚠ Conflicts with Game Night and Raid Night',
    );
  });

  it('renders no conflict marker when there are no conflicts', () => {
    renderRow([]);
    expect(screen.queryByTestId('slot-conflicts')).not.toBeInTheDocument();
  });
});

describe('SchedulingSlotRow — mobile tap target (ROK-1543 AC5)', () => {
  it('gives the vote toggle a full-width 44px target that relaxes to 36px on sm+', () => {
    renderRow([]);
    const vote = screen.getByRole('button', { name: /vote for/i });
    // WCAG 2.5.5 / Apple HIG on touch; the desktop row stays compact.
    expect(vote.className).toContain('min-h-[44px]');
    expect(vote.className).toContain('sm:min-h-[36px]');
    // Full-width on mobile so the whole row bottom is the target.
    expect(vote.className).toContain('w-full');
    expect(vote.className).toContain('sm:w-auto');
  });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1545 review F4/F5 — `canVote: false` has two very different causes.
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingSlotRow — no-vote viewers (ROK-1545 review)', () => {
    it('F4 — an anonymous viewer of an OPEN poll gets a sign-in CTA', () => {
        renderRow([], { canVote: false, signedIn: false });
        const cta = screen.getByTestId('slot-signin-cta');
        expect(cta).toHaveAttribute('href', expect.stringContaining('/auth/discord'));
        expect(screen.queryByRole('button', { name: /vote for/i })).toBeNull();
    });

    it('F4 — a SIGNED-IN disallowed viewer (private non-member) gets nothing', () => {
        renderRow([], { canVote: false, signedIn: true });
        expect(screen.queryByTestId('slot-signin-cta')).toBeNull();
        expect(screen.queryByRole('button', { name: /vote for/i })).toBeNull();
    });

    it('F5 — a voter still sees which slots they voted for once the poll ends', () => {
        renderRow([], { canVote: false, readOnly: true, voted: true });
        expect(screen.getByTestId('slot-voted-mark')).toHaveTextContent('✓ Voted');
        // Read-only: the mark is not a control.
        expect(screen.queryByRole('button', { name: /vote for/i })).toBeNull();
        expect(screen.queryByTestId('slot-signin-cta')).toBeNull();
    });

    it('F5 — a terminal poll shows no mark on a slot the viewer did not vote for', () => {
        renderRow([], { canVote: false, readOnly: true, voted: false });
        expect(screen.queryByTestId('slot-voted-mark')).toBeNull();
    });
});

/**
 * ROK-1617 AC4 — three answers, three colours.
 *
 * The pressed NO first shipped as `bg-overlay` + `border-edge-strong`, one
 * neutral step from the unanswered state while YES is emerald: the row read
 * as two states, not three. `red` is the sanctioned danger accent
 * (`docs/design-system.md` §2.2), remapped for the six light schemes at
 * `index.css:640-720`, so the house tint is safe in both families.
 */
describe('SchedulingSlotRow — pressed "doesn\'t work" state (ROK-1617 AC4)', () => {
  it('paints the pressed NO in the danger accent, not a neutral fill', () => {
    renderRow([], { noVoted: true });

    const no = screen.getByTestId('slot-no-toggle');
    expect(no.className).toContain('bg-red-500/10');
    expect(no.className).toContain('border-red-500/30');
    expect(no.className).toContain('text-red-400');
    expect(no.className).not.toContain('bg-overlay');
  });

  it('keeps the ✕ glyph so colour is never the only signal (AC5)', () => {
    renderRow([], { noVoted: true });
    expect(screen.getByTestId('slot-no-toggle').textContent).toContain('\u2715');
  });

  it('leaves the unanswered control neutral and un-tinted', () => {
    renderRow([], { noVoted: false });

    const no = screen.getByTestId('slot-no-toggle');
    expect(no.className).not.toContain('bg-red-500/10');
    expect(no.className).toContain('bg-surface');
  });
});

/**
 * ROK-1617 review MINOR — an `aria-label` on a bare `<span>` is dropped by
 * most screen readers (the generic role prohibits naming), so both state
 * markers were silent. `role="img"` is the smallest thing that makes the
 * glyph nameable.
 */
describe('SchedulingSlotRow — state markers are nameable (ROK-1617 AC5)', () => {
  it('names the ✕ marker to assistive tech', () => {
    renderRow([], { noVoted: true });
    expect(
      screen.getByRole('img', { name: /does not work/i }),
    ).toBeInTheDocument();
  });

  it('names the ✓ marker to assistive tech', () => {
    renderRow([], { voted: true });
    expect(screen.getByRole('img', { name: /you voted/i })).toBeInTheDocument();
  });
});

/**
 * SchedulingToolbar sticky-behaviour tests (ROK-1558).
 *
 * The hero used to be `sticky top-14` at EVERY width and auto-hid on mobile
 * scroll-down by translating itself off-screen. A transform does not collapse
 * the sticky box, so the hidden hero left a blank band its own height tall
 * above the slot ladder on a phone. Fix: sticky on desktop only (`md:sticky`)
 * and no transform at all — on mobile the hero scrolls away with the page.
 *
 * Child components are mocked: this spec is about the wrapper's own classes,
 * not the hero/actions it hosts.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/render-helpers';
import type { JourneyHeroProps } from '../../../shared/journey-hero/types';
import { SchedulingToolbar } from '../SchedulingToolbar';
import { buildPoll } from './scheduling-poll-fixtures';

vi.mock('../../../shared/journey-hero', () => ({
    // ROK-1582: the mock now renders the hero's action slots so the phone
    // layout of the creator/operator action row can be asserted here.
    JourneyHero: ({
        headerAction,
        action,
    }: {
        headerAction?: ReactNode;
        action?: ReactNode;
    }) => (
        <div data-testid="journey-hero">
            {action}
            {headerAction}
        </div>
    ),
}));
vi.mock('../../LineupParticipantsButton', () => ({
    LineupParticipantsButton: () => null,
}));
vi.mock('../SchedulingGameRefBanner', () => ({
    SchedulingGameRefBanner: () => null,
}));
vi.mock('../SchedulingCancelAction', () => ({
    SchedulingCancelAction: () => null,
}));
vi.mock('../SchedulingRemindAction', () => ({
    SchedulingRemindAction: () => null,
}));
vi.mock('../SchedulingAddMembersAction', () => ({
    SchedulingAddMembersAction: () => null,
}));
vi.mock('../SchedulingVoteProgress', () => ({
    SchedulingVoteProgress: () => null,
}));

function renderToolbar() {
    const poll = buildPoll();
    return renderWithProviders(
        <SchedulingToolbar
            hero={{ title: 'Valheim' } as JourneyHeroProps}
            match={poll.match}
            mode="from-match"
            lineupId={7}
            matchId={500}
            readOnly={false}
            uniqueVoterCount={2}
            canLock={false}
            leadingTimeLabel="Wed 10 Jun, 20:00"
            onLockLeader={vi.fn()}
        />,
    );
}

describe('SchedulingToolbar — sticky on desktop only (ROK-1558)', () => {
    it('pins from md up and never transforms itself off-screen', () => {
        renderToolbar();
        const classes = Array.from(
            screen.getByTestId('scheduling-toolbar').classList,
        );

        // Desktop keeps the pinned hero...
        expect(classes).toContain('md:sticky');
        expect(classes).toContain('md:top-14');
        // ...but mobile must NOT be sticky, or the auto-hide blank band
        // (a transformed-but-still-occupying sticky box) comes back.
        expect(classes).not.toContain('sticky');
        expect(classes).not.toContain('top-14');
        expect(
            classes.filter((c) => c.includes('translate')),
        ).toEqual([]);
    });
});

/**
 * ROK-1582: Add Participants / Remind Voters / Cancel Poll used to stack
 * one-per-line (`flex-col items-end`) as tiny pills that hung past the hero
 * card's right edge on a phone. They are now ONE full-width row below the
 * badge row, inline + right-aligned from `sm` up.
 */
describe('SchedulingToolbar — phone action row (ROK-1582)', () => {
    it('lays the creator actions out as one full-width row below sm', () => {
        renderToolbar();
        const classes = Array.from(
            screen.getByTestId('scheduling-hero-actions').classList,
        );

        expect(classes).toContain('flex');
        expect(classes).toContain('w-full');
        expect(classes).toContain('sm:w-auto');
        expect(classes).toContain('sm:justify-end');
        // Never a stacked column again — that is the reported bug.
        expect(classes).not.toContain('flex-col');
        expect(classes).not.toContain('items-end');
    });
});

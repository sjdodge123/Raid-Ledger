/**
 * ROK-1613 AC1 — "the button is ALWAYS on the group page".
 *
 * This is the file that can actually prove it. `LfgHero`'s action row never
 * receives `group`, so parameterising a hero test over participation shapes
 * renders the same markup three times; `LfgGroupTop` is where `activeCount`,
 * `ownIntent`, `convertedEvent` and `playingNow` decide WHICH row renders, so
 * every way the button could vanish is reachable from here.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import {
    createMockLfgGroupDetail,
    createMockLfgIntent,
    createMockLfgMember,
} from '../../test/lfg-factories';
import { LfgGroupTop } from './lfg-group-top';

const EVENT = { eventId: 91, title: 'Valheim', startTime: '2026-09-23T20:00:00', signupCount: 3 };
const PLAYING = {
    eventId: 42,
    startsAt: '2026-09-19T20:00:00Z',
    voiceChannelId: null,
    voiceInviteUrl: null,
    participantCount: 3,
};

function renderTop(over: Parameters<typeof createMockLfgGroupDetail>[0] = {}) {
    const group: LfgGroupDetailDto = createMockLfgGroupDetail(over);
    const onStartNow = vi.fn();
    renderWithProviders(
        <LfgGroupTop
            group={group}
            onJoin={vi.fn()}
            onStartPoll={vi.fn()}
            onStartNow={onStartNow}
            onParticipants={vi.fn()}
        />,
    );
    return { onStartNow };
}

describe('LfgGroupTop — the start-now action is ALWAYS offered (AC1)', () => {
    it.each([
        ['an empty group, viewer not in it', { activeCount: 0, nowCount: 0, ownIntent: null }],
        ['one week hand, held by the viewer', { activeCount: 1, nowCount: 0, ownIntent: createMockLfgIntent() }],
        ['two now hands (the threshold path)', { activeCount: 2, nowCount: 2, ownIntent: createMockLfgIntent({ urgency: 'now' }) }],
        ['a full group', { activeCount: 5, nowCount: 0, isViable: true, ownIntent: createMockLfgIntent() }],
    ])('renders with %s', (_label, over) => {
        renderTop(over);

        expect(screen.getByTestId('lfg-hero-start-now')).toBeInTheDocument();
    });

    /**
     * The regression this file was added for. A locked-in group is waiting on
     * a FUTURE event — it is not mid-session, so AC5's one sanctioned absence
     * does not apply. `OpenEventRow` used to replace the entire action row.
     */
    it('survives a locked-in event, where the group has no hands up', () => {
        renderTop({ activeCount: 0, ownIntent: null, convertedEvent: EVENT });

        expect(screen.getByTestId('lfg-hero-primary')).toHaveTextContent('Open the event');
        expect(screen.getByTestId('lfg-hero-start-now')).toBeInTheDocument();
    });

    /**
     * ...and it must not be a dead end. In the locked-in state `activeCount`
     * is 0, so NOBODY holds an intent and AC6 disables the button for
     * everyone. Without the join row the page would offer a permanently
     * disabled button and no way to earn it.
     */
    it('keeps a way IN while locked in — the button is gated but reachable', () => {
        renderTop({ activeCount: 0, ownIntent: null, convertedEvent: EVENT });

        expect(screen.getByTestId('lfg-hero-start-now')).toBeDisabled();
        expect(screen.getByTestId('lfg-join-row')).toBeInTheDocument();
        expect(screen.getByTestId('lfg-start-poll-hint')).toHaveTextContent(
            '+1 first — you have to be in the group',
        );
    });

    /**
     * A locked-in group ALSO has `activeCount === 0`, because lock-in converts
     * every intent. Showing the join row there (so start-now is reachable)
     * must not drag its empty-group line along: "Nobody's looking for a group
     * right now" directly under "EVENT SET / 3 signed up" contradicts itself.
     */
    it('does NOT claim the group is empty while an event is set', () => {
        renderTop({ activeCount: 0, ownIntent: null, convertedEvent: EVENT });

        expect(screen.getByTestId('lfg-join-row')).toBeInTheDocument();
        expect(
            screen.queryByText("Nobody's looking for a group right now — be the first"),
        ).toBeNull();
    });

    it('still says so when the group really is empty', () => {
        renderTop({ activeCount: 0, ownIntent: null, convertedEvent: null });

        expect(
            screen.getByText("Nobody's looking for a group right now — be the first"),
        ).toBeInTheDocument();
    });

    /** AC6 — rendered for a non-participant, but refused rather than missing. */
    it('renders disabled for a viewer holding no intent', () => {
        const { onStartNow } = renderTop({ activeCount: 2, ownIntent: null, members: [createMockLfgMember()] });

        expect(screen.getByTestId('lfg-hero-start-now')).toBeDisabled();
        expect(onStartNow).not.toHaveBeenCalled();
    });

    /** AC5 — the ONE sanctioned absence: a session is already live. */
    it('is absent only while the group is actually playing', () => {
        renderTop({ playingNow: PLAYING });

        expect(screen.getByTestId('lfg-playing-state')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-hero-start-now')).toBeNull();
    });
});

/**
 * ROK-1479 A7 — the "Right now" strip above the group's avatar row.
 *
 * TDD: `./LfgNowStrip` does not exist yet, so this file fails at import.
 *
 * What these cases pin (operator ruling A7 + D11):
 *   • only `urgency: 'now'` members appear, soonest to lapse FIRST — asserted
 *     as DOM ORDER, not as presence, because "now members first" is the whole
 *     acceptance criterion and a set-equality assertion would hold for any
 *     ordering;
 *   • each chip reads `🔥 {name} · {remaining}` and carries the exact instant
 *     in a `<time dateTime>` so the truth is available without a tick;
 *   • the countdown moves on the SHARED tick — advancing fake timers by the
 *     cadence rewrites the text;
 *   • unmounting clears the interval, and a strip with no `now` members mounts
 *     none at all (D11 — the group page mounts this on every group).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { createMockLfgMember } from '../../test/lfg-factories';
import { NOW_TICK_SLOW_MS } from '../../hooks/use-now-tick';
import { LfgNowStrip } from './LfgNowStrip';

const BASE = new Date('2026-09-05T12:00:00.000Z');

/** An ISO instant `seconds` from the frozen clock. */
function inSeconds(seconds: number): string {
    return new Date(BASE.getTime() + seconds * 1_000).toISOString();
}

/** A `now` member expiring `seconds` from the frozen clock. */
function nowMember(
    userId: number,
    username: string,
    seconds: number,
    over: Partial<LfgMemberDto> = {},
): LfgMemberDto {
    return createMockLfgMember({
        userId,
        username,
        displayName: null,
        urgency: 'now',
        expiresAt: inSeconds(seconds),
        ...over,
    });
}

/** Whitespace-normalised text of every chip, in DOM order. */
function chipTexts(): string[] {
    return screen
        .getAllByTestId('lfg-now-chip')
        .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
}

describe('LfgNowStrip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('orders the now members by soonest expiry', () => {
        render(
            <LfgNowStrip
                members={[
                    nowMember(1, 'ana', 41 * 60),
                    nowMember(2, 'bo', 9 * 60),
                    nowMember(3, 'kestrel', 24 * 60),
                ]}
            />,
        );

        expect(chipTexts()).toEqual([
            '🔥 bo · 9 min left',
            '🔥 kestrel · 24 min left',
            '🔥 ana · 41 min left',
        ]);
    });

    it('leaves the weekly members to the avatar row', () => {
        render(
            <LfgNowStrip
                members={[
                    createMockLfgMember({ userId: 4, username: 'weekly' }),
                    nowMember(3, 'kestrel', 24 * 60),
                ]}
            />,
        );

        expect(chipTexts()).toEqual(['🔥 kestrel · 24 min left']);
        expect(screen.queryByText(/weekly/)).not.toBeInTheDocument();
    });

    it('prefers the display name and carries the exact instant', () => {
        render(
            <LfgNowStrip
                members={[
                    nowMember(3, 'kestrel', 24 * 60, { displayName: 'Kes' }),
                ]}
            />,
        );

        expect(chipTexts()).toEqual(['🔥 Kes · 24 min left']);
        const chip = screen.getByTestId('lfg-now-chip');
        expect(chip.tagName).toBe('TIME');
        expect(chip).toHaveAttribute('datetime', inSeconds(24 * 60));
    });

    it('renders whole seconds inside the last two minutes', () => {
        render(<LfgNowStrip members={[nowMember(3, 'kestrel', 90)]} />);

        expect(chipTexts()).toEqual(['🔥 kestrel · 90s left']);
    });

    it('clamps a lapsed member to zero rather than going negative', () => {
        render(<LfgNowStrip members={[nowMember(3, 'kestrel', -30)]} />);

        expect(chipTexts()).toEqual(['🔥 kestrel · 0s left']);
    });

    it('rewrites the countdown when the shared tick fires', () => {
        render(<LfgNowStrip members={[nowMember(3, 'kestrel', 24 * 60 + 5)]} />);
        expect(chipTexts()).toEqual(['🔥 kestrel · 24 min left']);

        act(() => {
            vi.advanceTimersByTime(NOW_TICK_SLOW_MS);
        });

        expect(chipTexts()).toEqual(['🔥 kestrel · 23 min left']);
    });

    it('names the strip so the section is findable', () => {
        render(<LfgNowStrip members={[nowMember(3, 'kestrel', 24 * 60)]} />);

        expect(screen.getByTestId('lfg-now-strip')).toHaveTextContent(
            'Right now',
        );
    });

    it('renders nothing and mounts no interval without now members', () => {
        render(
            <LfgNowStrip members={[createMockLfgMember({ userId: 4 })]} />,
        );

        expect(screen.queryByTestId('lfg-now-strip')).not.toBeInTheDocument();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('renders nothing and mounts no interval for an empty roster', () => {
        render(<LfgNowStrip members={[]} />);

        expect(screen.queryByTestId('lfg-now-strip')).not.toBeInTheDocument();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the interval on unmount', () => {
        const { unmount } = render(
            <LfgNowStrip members={[nowMember(3, 'kestrel', 24 * 60)]} />,
        );
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });
});

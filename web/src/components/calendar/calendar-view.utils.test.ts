import { describe, it, expect } from 'vitest';
import { shouldRenderInCalendar } from './calendar-view.utils';
import type { EventResponseDto } from '@raid-ledger/contract';

// Minimal event factories — `shouldRenderInCalendar` only reads `event.game`,
// so we narrow the type to that single property to keep the fixtures tight.

type EventWithGame = Pick<EventResponseDto, 'game'>;

function eventWithGame(slug: string): EventWithGame {
    return {
        game: {
            id: 1,
            name: 'Test Game',
            slug,
            coverUrl: null,
        },
    };
}

function eventWithoutGame(): EventWithGame {
    return { game: null };
}

describe('shouldRenderInCalendar (ROK-1315)', () => {
    describe('when selectedGames is undefined (unfiltered)', () => {
        it('renders a gameless event', () => {
            expect(shouldRenderInCalendar(eventWithoutGame(), undefined)).toBe(true);
        });

        it('renders a game-having event', () => {
            expect(shouldRenderInCalendar(eventWithGame('wow-classic'), undefined)).toBe(true);
        });
    });

    describe('when selectedGames is a defined Set (filter chip active)', () => {
        it('renders a gameless event even when the set is empty', () => {
            // This is the ROK-1305 -> ROK-1315 regression case: the chip lands
            // on an empty Set after a "Deselect all", and the previous
            // predicate (`event.game?.slug && selectedGames.has(...)`) hid
            // every gameless variety-night event.
            expect(shouldRenderInCalendar(eventWithoutGame(), new Set())).toBe(true);
        });

        it('renders a gameless event when the set contains other slugs', () => {
            expect(
                shouldRenderInCalendar(
                    eventWithoutGame(),
                    new Set(['world-of-warcraft', 'baldurs-gate-3']),
                ),
            ).toBe(true);
        });

        it('renders a game-having event when its slug IS selected', () => {
            expect(
                shouldRenderInCalendar(
                    eventWithGame('world-of-warcraft'),
                    new Set(['world-of-warcraft', 'baldurs-gate-3']),
                ),
            ).toBe(true);
        });

        it('hides a game-having event when its slug is NOT selected', () => {
            expect(
                shouldRenderInCalendar(
                    eventWithGame('valorant'),
                    new Set(['world-of-warcraft', 'baldurs-gate-3']),
                ),
            ).toBe(false);
        });

        it('hides a game-having event when the selected set is empty', () => {
            expect(
                shouldRenderInCalendar(eventWithGame('wow-classic'), new Set()),
            ).toBe(false);
        });
    });
});

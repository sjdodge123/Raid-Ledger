/** S4 desktop marker "… · also on Google Calendar" (ROK-1595 AC 9, ruling F-3, G-1). */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { calendarCopyEventBlockFixture } from '../../../test/mocks/game-time-calendar-handlers';
import { EventBlockOverlays } from './EventBlockOverlays';

const DIMS = { colWidth: 100, rowHeight: 40, headerHeight: 30, colStartLeft: 52 };
const renderBlocks = (events: GameTimeEventBlock[]) =>
    render(<EventBlockOverlays displayEvents={events} gridDims={DIMS} rangeStart={0} rangeEnd={24} />);

describe('EventBlockOverlays — synced calendar copy marker', () => {
    it('reads "You\'re in · also on Google Calendar" when the sign-up has a calendar copy', () => {
        renderBlocks([calendarCopyEventBlockFixture]);
        expect(screen.getByTestId('event-block-calendar-copy')).toHaveTextContent("You're in · also on Google Calendar");
        expect(screen.getByTestId('event-block-501-3')).toHaveAttribute(
            'title', "Raid Night · You're in · also on Google Calendar");
    });

    it('shows no marker when calendarCopy is absent', () => {
        const plain: GameTimeEventBlock = { ...calendarCopyEventBlockFixture };
        delete plain.calendarCopy;
        renderBlocks([plain]);
        expect(screen.queryByTestId('event-block-calendar-copy')).not.toBeInTheDocument();
        expect(screen.getByTestId('event-block-501-3')).toHaveAttribute('title', 'Raid Night');
    });
});

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MonthEventComponent } from './MonthEventComponent';
import type { CalendarEvent } from './CalendarView';
import type { EventResponseDto } from '@raid-ledger/contract';

function makeEvent(overrides: Partial<EventResponseDto> = {}): CalendarEvent {
    const resource: EventResponseDto = {
        id: 1,
        title: 'Raid night',
        description: '',
        startTime: '2026-02-10T20:00:00Z',
        endTime: '2026-02-10T23:00:00Z',
        creator: { id: 10, username: 'RaidLeader', avatar: null },
        game: { id: 1, name: 'BG3', slug: 'bg3', coverUrl: null },
        signupCount: 0,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
        ...overrides,
    };
    return { id: 1, title: resource.title, start: new Date(resource.startTime), end: new Date(resource.endTime), resource };
}

function renderChip(event: CalendarEvent) {
    const { container } = render(
        <MonthEventComponent event={event} eventOverlapsGameTime={() => false} onChipClick={vi.fn()} />,
    );
    const chip = container.querySelector('.calendar-event-chip');
    if (!chip) throw new Error('month chip not rendered');
    return chip;
}

describe('MonthEventComponent — hub in tooltip only (ROK-1893 V2)', () => {
    it('appends the hub to the title and aria-label, with no visible marker', () => {
        const chip = renderChip(makeEvent({ hub: { id: 7, name: 'BG3 Friends', kind: 'game_community' } }));
        expect(chip.getAttribute('title')).toBe('Raid night (BG3) · BG3 Friends');
        expect(chip.getAttribute('aria-label')).toBe('Raid night (BG3) · BG3 Friends');
        expect(chip.textContent).not.toContain('BG3 Friends');
    });

    it('leaves the title unchanged for an untagged event', () => {
        const chip = renderChip(makeEvent({ hub: null }));
        expect(chip.getAttribute('title')).toBe('Raid night (BG3)');
    });
});

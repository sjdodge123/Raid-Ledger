/**
 * ActivityTimeline toggle state (ROK-1596). The collapsible header exposes its
 * state via aria-expanded so callers (and the activity-timeline smoke spec)
 * can tell open from closed without probing page-wide CSS classes — the old
 * `.border-t.border-edge` probe collided with the event page's calendar line.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActivityEntryDto } from '@raid-ledger/contract';
import { ActivityTimeline } from './ActivityTimeline';

const entries: ActivityEntryDto[] = [
    { id: 1, action: 'event_created', actor: null, metadata: null, createdAt: new Date().toISOString() },
];

vi.mock('../../hooks/use-activity-timeline', () => ({
    useActivityTimeline: () => ({ data: { data: entries }, isLoading: false }),
}));

describe('ActivityTimeline toggle', () => {
    it('reports collapsed then expanded through aria-expanded', () => {
        render(<ActivityTimeline entityType="event" entityId={7} />);
        const toggle = screen.getByRole('button', { name: /Activity · 1 event/ });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('starts expanded when not collapsible', () => {
        render(<ActivityTimeline entityType="event" entityId={7} collapsible={false} />);
        const toggle = screen.getByRole('button', { name: /Activity · 1 event/ });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
});

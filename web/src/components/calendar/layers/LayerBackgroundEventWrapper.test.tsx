import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LayerBackgroundEventWrapper } from './LayerBackgroundEventWrapper';
import type { LayerWindowEvent } from './calendar-layer-events';

const LAYER_EVENT: LayerWindowEvent = {
    id: 'w1', title: 'Server up', start: new Date('2026-02-10T13:00:00Z'), end: new Date('2026-02-10T17:00:00Z'), continued: false,
    layer: { kind: 'window', id: 'w1', start: '2026-02-10T13:00:00Z', end: '2026-02-10T17:00:00Z', label: 'Server up', ariaLabel: 'Server up' },
};
const CALENDAR_EVENT = { id: 1, title: 'Raid', start: new Date(), end: new Date(), resource: {} };

function renderWrapped(event: object) {
    render(<LayerBackgroundEventWrapper event={event}><div data-testid="inner" role="button" tabIndex={0}>x</div></LayerBackgroundEventWrapper>);
    return screen.getByTestId('inner');
}

describe('LayerBackgroundEventWrapper (ROK-1774)', () => {
    it('drops the button role and the tab stop from a layer band', () => {
        const inner = renderWrapped(LAYER_EVENT);
        expect(inner).not.toHaveAttribute('role');
        expect(inner).not.toHaveAttribute('tabindex');
    });

    it('leaves a calendar event as a focusable button', () => {
        const inner = renderWrapped(CALENDAR_EVENT);
        expect(inner).toHaveAttribute('role', 'button');
        expect(inner).toHaveAttribute('tabindex', '0');
    });
});

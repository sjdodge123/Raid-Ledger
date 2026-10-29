import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventHubLabel } from './event-hub-label';
import { hubSuffixText } from './event-hub-label.helpers';

const HUB = { id: 7, name: 'BG3 Friends', kind: 'game_community' as const };

describe('EventHubLabel (ROK-1893 V1)', () => {
    it('renders " · <hub>" in a muted span when the event has a hub', () => {
        render(<p>Baldur&apos;s Gate 3<EventHubLabel hub={HUB} /></p>);
        const label = screen.getByTestId('event-hub-label');
        expect(label.textContent).toBe(' · BG3 Friends');
        expect(label.className).toBe('text-muted');
    });

    it('takes a className override for game-art cards', () => {
        render(<EventHubLabel hub={HUB} className="opacity-80" />);
        expect(screen.getByTestId('event-hub-label').className).toBe('opacity-80');
    });

    it('renders nothing for a null or absent hub', () => {
        const { container: nullHub } = render(<EventHubLabel hub={null} />);
        const { container: noHub } = render(<EventHubLabel hub={undefined} />);
        expect(nullHub.innerHTML).toBe('');
        expect(noHub.innerHTML).toBe('');
    });

    it('hubSuffixText gives the same suffix as plain text, or empty', () => {
        expect(hubSuffixText(HUB)).toBe(' · BG3 Friends');
        expect(hubSuffixText(null)).toBe('');
        expect(hubSuffixText(undefined)).toBe('');
    });
});

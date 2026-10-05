/**
 * ROK-1719: the instance chip shows the short name but exposes the full
 * instance name on hover.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WowInstanceDetailDto } from '@raid-ledger/contract';
import { EventDetailContentSections } from './event-detail-content-sections';

const HYJAL: WowInstanceDetailDto = {
    id: 90_000_001,
    name: 'Hyjal Summit',
    shortName: 'Hyjal',
    expansion: 'Classic',
    minimumLevel: 60,
    maximumLevel: 60,
    maxPlayers: 40,
    category: 'raid',
};

describe('EventDetailContentSections — chip title (ROK-1719)', () => {
    it('carries the full instance name as the chip title', () => {
        render(<EventDetailContentSections contentInstances={[HYJAL]} />);
        const chip = screen.getByText('Hyjal');
        expect(chip.getAttribute('title'), 'chip must expose the full instance name').toBe('Hyjal Summit');
    });
});

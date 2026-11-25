/** ROK-2319: the Draft pill is neutral, so it takes token classes that repaint per scheme. */
import { describe, it, expect } from 'vitest';
import { STATUS_STYLES } from './event-plans-list.utils';

describe('STATUS_STYLES', () => {
    it('paints the Draft pill with the documented neutral status chip (StatusChip neutral), never a raw gray', () => {
        expect(STATUS_STYLES.draft).toEqual({ bg: 'bg-panel border border-edge', text: 'text-muted', label: 'Draft' });
    });
});

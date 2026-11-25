/** ROK-2319: the bench pill is neutral, so it takes token classes that repaint per scheme. */
import { describe, it, expect } from 'vitest';
import { ROLE_BADGE_CLASSES } from './role-colors';

describe('ROLE_BADGE_CLASSES', () => {
    it('paints the bench pill with the documented neutral status chip (StatusChip neutral), never a raw slate', () => {
        expect(ROLE_BADGE_CLASSES.bench).toBe('bg-panel border border-edge text-muted');
    });
});

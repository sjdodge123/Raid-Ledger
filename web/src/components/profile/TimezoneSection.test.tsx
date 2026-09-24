/**
 * TimezoneSection (ROK-1648 L11): the Timezone select sits in a Field with a
 * visually hidden label (the section's h2 is the visible caption) and uses the
 * lg Select frame; the "currently showing" zone wears the success token.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimezoneSection } from './TimezoneSection';
import { FIELD_PAD } from '../ui/form-classes';

vi.mock('../../lib/api-client', () => ({
    updatePreference: vi.fn().mockResolvedValue(undefined),
}));

describe('TimezoneSection (ROK-1648)', () => {
    it('names the Timezone select through a hidden Field label', () => {
        render(<TimezoneSection />);
        const select = screen.getByRole('combobox', { name: 'Timezone' });
        const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
        expect(label, 'a <label for> from Field should name the Timezone select').not.toBeNull();
        expect(label!.className, 'the Field label should be visually hidden (hideLabel)').toContain('sr-only');
    });

    it('uses the lg Select frame and no raw emerald focus ring', () => {
        render(<TimezoneSection />);
        const select = screen.getByRole('combobox', { name: 'Timezone' });
        expect(select.className, 'the Timezone select should drop focus:ring-emerald-500').not.toContain('emerald');
        expect(select.className, 'the Timezone select should use the lg field padding').toContain(FIELD_PAD.lg);
        expect(select.parentElement?.querySelector('svg'), 'the Select primitive draws its chevron').not.toBeNull();
    });

    it('shows the active zone abbreviation in the success token', () => {
        render(<TimezoneSection />);
        const note = screen.getByText(/currently showing times in/i);
        const abbr = note.querySelector('span');
        expect(abbr?.className, 'the active zone should wear text-success, not a raw emerald').toContain('text-success');
    });
});

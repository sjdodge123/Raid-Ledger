/**
 * ROK-1170 — the hub `heroBanner` sample on /dev/design-system mounts the real
 * WoW guild-state banner view in both variants (member: copy only; editor:
 * plus "Update the guild path") and the real Founded pill.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HubHeroBannerSection } from './hub-hero-banner-section';

describe('HubHeroBannerSection', () => {
    it('shows the member banner without the editor action', () => {
        render(<HubHeroBannerSection />);
        const member = screen.getByTestId('ds-hero-banner-member');
        expect(within(member).getByRole('status')).toHaveTextContent('Blizzard no longer finds this guild');
        expect(within(member).queryByRole('button', { name: 'Update the guild path' })).toBeNull();
    });

    it('shows the editor banner with the Update the guild path action', () => {
        render(<HubHeroBannerSection />);
        const editor = screen.getByTestId('ds-hero-banner-editor');
        expect(within(editor).getByRole('button', { name: 'Update the guild path' })).toBeInTheDocument();
    });

    it('shows the Founded pill in the hero stub', () => {
        render(<HubHeroBannerSection />);
        expect(screen.getAllByText(/^Founded /).length).toBeGreaterThan(0);
    });
});

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    SEEDED_PUBLIC_GUILD_SLUG,
    createMockPublicGuildCard,
    publicGuildCardHandler,
} from '../../../test/mocks/public-guild-card-handlers';
import { PublicGuildCardPage } from './public-guild-card-page';

function renderAt(slug: string, calls: string[] = []) {
    server.use(publicGuildCardHandler(createMockPublicGuildCard(), calls));
    return renderWithProviders(
        <Routes><Route path="/p/guild/:slug" element={<PublicGuildCardPage />} /></Routes>,
        { initialEntries: [`/p/guild/${slug}`] },
    );
}

const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');

describe('PublicGuildCardPage', () => {
    it('renders the card for a live slug, with no auth provider mounted', async () => {
        renderAt(SEEDED_PUBLIC_GUILD_SLUG);
        expect(await screen.findByTestId('public-guild-card')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Iron Vanguard' })).toBeInTheDocument();
        expect(screen.getByTestId('public-guild-card-apply')).toHaveAttribute('href', 'https://example.com/apply');
    });

    it('shows the not-found state on a 404', async () => {
        renderAt('Zz9yX8wV7uT6sR5q');
        expect(await screen.findByTestId('public-guild-card-not-found')).toHaveTextContent("This page doesn't exist.");
        expect(screen.queryByTestId('public-guild-card')).not.toBeInTheDocument();
    });

    it('a malformed slug is not-found without a request', () => {
        const calls: string[] = [];
        renderAt('not-a-slug', calls);
        expect(screen.getByTestId('public-guild-card-not-found')).toBeInTheDocument();
        expect(calls).toEqual([]);
    });

    it('carries a noindex robots meta while mounted and removes it on unmount', async () => {
        const { unmount } = renderAt(SEEDED_PUBLIC_GUILD_SLUG);
        await screen.findByTestId('public-guild-card');
        expect(robots()?.content).toBe('noindex, nofollow');
        unmount();
        expect(robots()).toBeNull();
    });
});

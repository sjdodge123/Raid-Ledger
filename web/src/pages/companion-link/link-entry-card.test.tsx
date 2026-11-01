/** ROK-2056 AC7/AC9 — `/link` entry card's "Don't have the app? Download it" line. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { LinkEntryCard } from './link-entry-card';

const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../lib/companion-install', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/companion-install')>()),
    companionDownloadAvailable: () => flag.on,
}));

function renderCard(): void {
    renderWithProviders(
        <LinkEntryCard code="" error={undefined} loading={false} onCodeChange={vi.fn()} onSubmit={vi.fn()} />,
    );
}

beforeEach(() => { flag.on = true; });

describe('LinkEntryCard download line (ROK-2056)', () => {
    it('links "Download it" to the Companion card on My Integrations', () => {
        renderCard();
        expect(screen.getByTestId('link-download-line')).toHaveTextContent("Don't have the app? Download it");
        expect(screen.getByRole('link', { name: 'Download it' })).toHaveAttribute('href', '/profile/integrations#companion');
    });

    it('renders no download line while the download is unavailable', () => {
        flag.on = false;
        renderCard();
        expect(screen.queryByTestId('link-download-line')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Download it' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });
});

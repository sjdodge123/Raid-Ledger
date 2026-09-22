/**
 * BuildFixesNotice tests (ROK-1475 S4).
 *
 * Covers: count pill copy + compare link, singular copy, 0 → "up to date"
 * with no pill (§4.12 never renders a zero badge), null → version alone,
 * pill without a link when fixesCompareUrl is null, enabled:false renders
 * nothing and never fetches.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import { BuildFixesNotice } from './BuildFixesNotice';
import type { UpdateStatusDto } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
const COMPARE_URL = 'https://github.com/sjdodge123/Raid-Ledger/compare/74b92a0...main';

function mockStatus(overrides: Partial<UpdateStatusDto> = {}): UpdateStatusDto {
    return {
        currentVersion: '1.4.0',
        latestVersion: '1.4.0',
        updateAvailable: false,
        lastChecked: '2026-09-22T00:00:00Z',
        latestReleaseUrl: null,
        fixesAvailable: 3,
        runningCommitSha: '74b92a0',
        latestCommitSha: '3ab490a',
        fixesCompareUrl: COMPARE_URL,
        ...overrides,
    };
}

function serve(dto: UpdateStatusDto): void {
    server.use(http.get(`${API_BASE}/admin/update-status`, () => HttpResponse.json(dto)));
}

describe('BuildFixesNotice (ROK-1475 S4)', () => {
    it('renders "v1.4.0 · 3 fixes available" with the pill linked to the compare span', async () => {
        serve(mockStatus());
        renderWithProviders(<BuildFixesNotice enabled />);
        // The accessible name says where the link goes (review finding).
        const pill = await screen.findByRole('link', {
            name: '3 fixes available, view changes on GitHub (opens in new tab)',
        });
        expect(pill).toHaveTextContent('3 fixes available');
        expect(pill).toHaveAttribute('href', COMPARE_URL);
        expect(pill).toHaveAttribute('target', '_blank');
        expect(pill).toHaveAttribute('rel', 'noopener noreferrer');
        expect(pill.className).toContain('rounded-full');
        expect(screen.getByTestId('build-fixes-notice')).toHaveTextContent('v1.4.0·3 fixes available');
    });

    it('uses singular copy for one fix', async () => {
        serve(mockStatus({ fixesAvailable: 1 }));
        renderWithProviders(<BuildFixesNotice enabled />);
        const pill = await screen.findByRole('link', {
            name: '1 fix available, view changes on GitHub (opens in new tab)',
        });
        expect(pill).toHaveTextContent('1 fix available');
    });

    it('renders "up to date" and no pill when fixesAvailable is 0', async () => {
        serve(mockStatus({ fixesAvailable: 0, fixesCompareUrl: null }));
        renderWithProviders(<BuildFixesNotice enabled />);
        expect(await screen.findByText('up to date')).toBeInTheDocument();
        expect(screen.queryByTestId('fixes-pill')).not.toBeInTheDocument();
        expect(screen.getByTestId('build-fixes-notice')).toHaveTextContent('v1.4.0·up to date');
    });

    it('renders the version alone when fixesAvailable is null (unknown, never coerced to 0)', async () => {
        serve(mockStatus({ fixesAvailable: null, fixesCompareUrl: null }));
        renderWithProviders(<BuildFixesNotice enabled />);
        const notice = await screen.findByTestId('build-fixes-notice');
        expect(notice).toHaveTextContent(/^v1\.4\.0$/);
        expect(screen.queryByText('up to date')).not.toBeInTheDocument();
        expect(screen.queryByTestId('fixes-pill')).not.toBeInTheDocument();
    });

    it('renders an unlinked pill when fixesCompareUrl is null', async () => {
        serve(mockStatus({ fixesAvailable: 2, fixesCompareUrl: null }));
        renderWithProviders(<BuildFixesNotice enabled />);
        const pill = await screen.findByTestId('fixes-pill');
        expect(pill).toHaveTextContent('2 fixes available');
        expect(pill.tagName).toBe('SPAN');
    });

    it('renders nothing and never fetches when enabled is false', async () => {
        const handler = vi.fn(() => HttpResponse.json(mockStatus()));
        server.use(http.get(`${API_BASE}/admin/update-status`, handler));
        const { container } = renderWithProviders(<BuildFixesNotice enabled={false} />);
        await new Promise((r) => setTimeout(r, 50));
        expect(handler).not.toHaveBeenCalled();
        expect(container).toBeEmptyDOMElement();
    });
});

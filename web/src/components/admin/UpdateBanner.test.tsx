/**
 * UpdateBanner component tests (ROK-1242).
 *
 * Covers:
 *   - Renders both versions when updateAvailable: true.
 *   - Link href uses data.latestReleaseUrl when present.
 *   - Link falls back to lowercase /releases when latestReleaseUrl is null.
 *   - Dismiss click writes the version-scoped sessionStorage key.
 *   - Pre-set sessionStorage key suppresses the banner.
 *   - A different latestVersion re-shows the banner even when a prior
 *     version's key is set.
 *   - enabled: false (non-admin) keeps the MSW handler from being hit
 *     and the component renders nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import { UpdateBanner } from './UpdateBanner';
import type { UpdateStatusDto } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
const RELEASE_URL =
    'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v1.2.0';

function mockStatus(overrides: Partial<UpdateStatusDto> = {}): UpdateStatusDto {
    return {
        currentVersion: '1.0.0',
        latestVersion: '1.2.0',
        updateAvailable: true,
        lastChecked: '2026-05-14T00:00:00Z',
        latestReleaseUrl: RELEASE_URL,
        ...overrides,
    };
}

function useUpdateStatusHandler(dto: UpdateStatusDto): void {
    server.use(
        http.get(`${API_BASE}/admin/update-status`, () => HttpResponse.json(dto)),
    );
}

beforeEach(() => {
    sessionStorage.clear();
});

describe('UpdateBanner — visible state (ROK-1242)', () => {
    it('renders both current + latest version when an update is available', async () => {
        useUpdateStatusHandler(mockStatus());

        renderWithProviders(<UpdateBanner enabled />);

        await waitFor(() => {
            expect(
                screen.getByText(/A new version of Raid Ledger is available/),
            ).toBeInTheDocument();
        });
        expect(screen.getByText(/v1\.2\.0/)).toBeInTheDocument();
        expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
    });

    it('link href uses data.latestReleaseUrl when present', async () => {
        useUpdateStatusHandler(mockStatus({ latestReleaseUrl: RELEASE_URL }));

        renderWithProviders(<UpdateBanner enabled />);

        const link = await screen.findByRole('link', { name: /View release notes/i });
        expect(link).toHaveAttribute('href', RELEASE_URL);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('link falls back to lowercase /releases when latestReleaseUrl is null', async () => {
        useUpdateStatusHandler(mockStatus({ latestReleaseUrl: null }));

        renderWithProviders(<UpdateBanner enabled />);

        const link = await screen.findByRole('link', { name: /View release notes/i });
        expect(link).toHaveAttribute(
            'href',
            'https://github.com/sjdodge123/Raid-Ledger/releases',
        );
    });

    it('banner is wrapped in role="status" for accessibility', async () => {
        useUpdateStatusHandler(mockStatus());

        renderWithProviders(<UpdateBanner enabled />);

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeInTheDocument();
        });
    });
});

describe('UpdateBanner — hidden states (ROK-1242)', () => {
    it('renders nothing when updateAvailable is false', async () => {
        useUpdateStatusHandler(
            mockStatus({ updateAvailable: false, latestReleaseUrl: null }),
        );

        const { container } = renderWithProviders(<UpdateBanner enabled />);

        await waitFor(() => {
            expect(
                screen.queryByText(/A new version of Raid Ledger is available/),
            ).not.toBeInTheDocument();
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when latestVersion is null', async () => {
        useUpdateStatusHandler(
            mockStatus({
                latestVersion: null,
                updateAvailable: true,
                latestReleaseUrl: null,
            }),
        );

        const { container } = renderWithProviders(<UpdateBanner enabled />);

        // Give react-query a chance to resolve, then verify nothing rendered.
        await waitFor(() => {
            expect(container).toBeEmptyDOMElement();
        });
    });

    it('renders nothing when enabled is false (non-admin)', async () => {
        const handler = vi.fn(() => HttpResponse.json(mockStatus()));
        server.use(http.get(`${API_BASE}/admin/update-status`, handler));

        const { container } = renderWithProviders(<UpdateBanner enabled={false} />);

        // No fetch should happen, no banner should render.
        await new Promise((r) => setTimeout(r, 50));
        expect(handler).not.toHaveBeenCalled();
        expect(container).toBeEmptyDOMElement();
    });
});

describe('UpdateBanner — sessionStorage dismissal (ROK-1242)', () => {
    it('clicking dismiss writes the version-scoped sessionStorage key', async () => {
        useUpdateStatusHandler(mockStatus());

        renderWithProviders(<UpdateBanner enabled />);

        const dismissButton = await screen.findByRole('button', {
            name: /Dismiss update banner/i,
        });
        fireEvent.click(dismissButton);

        expect(
            sessionStorage.getItem('raid_ledger_update_banner_dismissed_v1.2.0'),
        ).toBe('1');
        await waitFor(() => {
            expect(
                screen.queryByText(/A new version of Raid Ledger is available/),
            ).not.toBeInTheDocument();
        });
    });

    it('mounting with the version-scoped key pre-set suppresses the banner', async () => {
        sessionStorage.setItem(
            'raid_ledger_update_banner_dismissed_v1.2.0',
            '1',
        );
        useUpdateStatusHandler(mockStatus());

        renderWithProviders(<UpdateBanner enabled />);

        // Wait a tick for useQuery + useEffect to run; banner must not appear.
        await new Promise((r) => setTimeout(r, 50));
        expect(
            screen.queryByText(/A new version of Raid Ledger is available/),
        ).not.toBeInTheDocument();
    });

    it('a different latestVersion re-shows the banner even when a prior version key is set', async () => {
        sessionStorage.setItem(
            'raid_ledger_update_banner_dismissed_v1.2.0',
            '1',
        );
        useUpdateStatusHandler(
            mockStatus({
                latestVersion: '1.3.0',
                latestReleaseUrl:
                    'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v1.3.0',
            }),
        );

        renderWithProviders(<UpdateBanner enabled />);

        await waitFor(() => {
            expect(screen.getByText(/v1\.3\.0/)).toBeInTheDocument();
        });
    });

    it('falls back to in-memory dismissal when sessionStorage.setItem throws', async () => {
        const originalSetItem = sessionStorage.setItem.bind(sessionStorage);
        sessionStorage.setItem = vi.fn(() => {
            throw new Error('QuotaExceededError');
        });
        try {
            useUpdateStatusHandler(mockStatus());

            renderWithProviders(<UpdateBanner enabled />);

            const dismissButton = await screen.findByRole('button', {
                name: /Dismiss update banner/i,
            });
            fireEvent.click(dismissButton);

            // Banner hides via the in-memory fallback even though storage write threw.
            await waitFor(() => {
                expect(
                    screen.queryByText(
                        /A new version of Raid Ledger is available/,
                    ),
                ).not.toBeInTheDocument();
            });
        } finally {
            sessionStorage.setItem = originalSetItem;
        }
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { DiscoveryCategorySuggestionDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { DynamicCategoriesPanel } from './dynamic-categories-panel';

const API_BASE = 'http://localhost:3000';

vi.mock('../../hooks/use-auth', () => ({
    getAuthToken: () => 'test-token',
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
vi.mock('../../lib/toast', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
        info: (...args: unknown[]) => mockToastInfo(...args),
    },
}));

function mockSuggestion(
    overrides: Partial<DiscoveryCategorySuggestionDto> = {},
): DiscoveryCategorySuggestionDto {
    return {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Seasonal Pick',
        description: 'Seasonal co-op games',
        categoryType: 'seasonal',
        themeVector: [0.5, 0, 0, 0, 0, 0, 0],
        filterCriteria: {},
        candidateGameIds: [1, 2],
        status: 'pending',
        populationStrategy: 'vector',
        sortOrder: 1,
        expiresAt: null,
        generatedAt: '2026-04-22T00:00:00.000Z',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: '2026-04-22T00:00:00.000Z',
        ...overrides,
    };
}

function stubList(byStatus: Record<string, DiscoveryCategorySuggestionDto[]>) {
    server.use(
        http.get(`${API_BASE}/admin/discovery-categories`, ({ request }) => {
            const url = new URL(request.url);
            const status = url.searchParams.get('status') ?? 'pending';
            return HttpResponse.json({
                suggestions: byStatus[status] ?? [],
            });
        }),
    );
}

describe('DynamicCategoriesPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: feature enabled so the panel body renders.
        server.use(
            http.get(`${API_BASE}/admin/ai/features`, () =>
                HttpResponse.json({
                    chatEnabled: false,
                    dynamicCategoriesEnabled: true,
                }),
            ),
            http.put(`${API_BASE}/admin/ai/features`, () =>
                HttpResponse.json({ success: true }),
            ),
        );
    });

    it('renders the Dynamic Categories heading', async () => {
        stubList({ pending: [] });
        renderWithProviders(<DynamicCategoriesPanel />);
        expect(
            await screen.findByRole('heading', {
                name: 'Dynamic Categories',
            }),
        ).toBeInTheDocument();
    });

    it('shows the empty state with a Regenerate button when pending is empty', async () => {
        stubList({ pending: [] });
        renderWithProviders(<DynamicCategoriesPanel />);
        expect(
            await screen.findByText(/no suggestions yet/i),
        ).toBeInTheDocument();
        expect(
            screen.getAllByRole('button', { name: /regenerate/i }).length,
        ).toBeGreaterThanOrEqual(1);
    });

    it('shows a generic empty state on approved tab', async () => {
        stubList({ pending: [], approved: [] });
        renderWithProviders(<DynamicCategoriesPanel />);
        const approvedBtn = await screen.findByRole('button', {
            name: 'Approved',
        });
        fireEvent.click(approvedBtn);
        expect(
            await screen.findByText(/nothing here yet/i),
        ).toBeInTheDocument();
    });

    it('renders cards from list data', async () => {
        stubList({ pending: [mockSuggestion({ name: 'Autumn Co-op' })] });
        renderWithProviders(<DynamicCategoriesPanel />);
        expect(await screen.findByText('Autumn Co-op')).toBeInTheDocument();
    });

    it('shows the vectors-not-ready banner when all pending candidates are empty', async () => {
        stubList({
            pending: [
                mockSuggestion({
                    id: 'a1',
                    name: 'a',
                    candidateGameIds: [],
                }),
                mockSuggestion({
                    id: 'a2',
                    name: 'b',
                    candidateGameIds: [],
                }),
            ],
        });
        renderWithProviders(<DynamicCategoriesPanel />);
        expect(
            await screen.findByTestId('dynamic-categories-vectors-not-ready'),
        ).toBeVisible();
    });

    it('hides the vectors-not-ready banner when at least one candidate list is populated', async () => {
        stubList({
            pending: [
                mockSuggestion({
                    id: 'a1',
                    candidateGameIds: [],
                }),
                mockSuggestion({
                    id: 'a2',
                    candidateGameIds: [1],
                }),
            ],
        });
        renderWithProviders(<DynamicCategoriesPanel />);
        const cards = await screen.findAllByTestId('dynamic-category-card');
        expect(cards).toHaveLength(2);
        expect(
            screen.queryByTestId('dynamic-categories-vectors-not-ready'),
        ).toBeNull();
    });

    it('approves a pending suggestion via the card Approve button', async () => {
        const suggestion = mockSuggestion({ id: 'zz', name: 'Approve Me' });
        stubList({ pending: [suggestion] });
        let approveCalled = false;
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/zz/approve`,
                () => {
                    approveCalled = true;
                    return HttpResponse.json({
                        ...suggestion,
                        status: 'approved',
                    });
                },
            ),
        );
        renderWithProviders(<DynamicCategoriesPanel />);
        const card = await screen.findByTestId('dynamic-category-card');
        fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(approveCalled).toBe(true));
    });

    it('rejects a pending suggestion via the card Reject button', async () => {
        const suggestion = mockSuggestion({ id: 'rr', name: 'Reject Me' });
        stubList({ pending: [suggestion] });
        let rejectCalled = false;
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/rr/reject`,
                () => {
                    rejectCalled = true;
                    return HttpResponse.json({
                        ...suggestion,
                        status: 'rejected',
                    });
                },
            ),
        );
        renderWithProviders(<DynamicCategoriesPanel />);
        const card = await screen.findByTestId('dynamic-category-card');
        fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
        await waitFor(() => expect(rejectCalled).toBe(true));
    });

    it('opens the edit modal and saves via PATCH', async () => {
        const suggestion = mockSuggestion({ id: 'ee', name: 'Editable' });
        stubList({ pending: [suggestion] });
        let patchBody: Record<string, unknown> | null = null;
        server.use(
            http.patch(
                `${API_BASE}/admin/discovery-categories/ee`,
                async ({ request }) => {
                    patchBody = (await request.json()) as Record<
                        string,
                        unknown
                    >;
                    return HttpResponse.json({
                        ...suggestion,
                        name: 'Renamed',
                    });
                },
            ),
        );
        renderWithProviders(<DynamicCategoriesPanel />);
        const card = await screen.findByTestId('dynamic-category-card');
        fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
        const modal = await screen.findByRole('dialog');
        fireEvent.change(within(modal).getByLabelText(/name/i), {
            target: { value: 'Renamed' },
        });
        fireEvent.click(within(modal).getByRole('button', { name: 'Save' }));
        await waitFor(() => {
            expect(patchBody).not.toBeNull();
            expect(patchBody).toMatchObject({ name: 'Renamed' });
        });
    });

    it('triggers regenerate via the panel header button', async () => {
        stubList({ pending: [] });
        let regenCalled = false;
        server.use(
            http.post(
                `${API_BASE}/admin/discovery-categories/regenerate`,
                () => {
                    regenCalled = true;
                    return HttpResponse.json({ ok: true });
                },
            ),
        );
        renderWithProviders(<DynamicCategoriesPanel />);
        await screen.findByText(/no suggestions yet/i);
        // Click the header Regenerate button (first one).
        const buttons = screen.getAllByRole('button', { name: /regenerate/i });
        fireEvent.click(buttons[0]);
        await waitFor(() => expect(regenCalled).toBe(true));
    });
});

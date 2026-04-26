/**
 * Tests for PersonalSuggestionsRow (ROK-931, ROK-1114).
 *
 * Verifies that the per-user "Suggested for you" row:
 *   - Calls the backend with `?personalize=me` (not the group-scope URL).
 *   - Renders nothing on empty success (don't pollute modal with empty section).
 *   - Surfaces an inline "Suggestions temporarily unavailable" message
 *     when the hook reports `kind === 'unavailable'` (503) — ROK-1114
 *     replaces the silent-null behavior.
 *   - Surfaces "AI suggestions unavailable" on a generic query error.
 *   - Renders cards with Pick buttons on success, and Pick fires
 *     `onPickSuggestion(dto)`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { PersonalSuggestionsRow } from './PersonalSuggestionsRow';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';

const API_BASE = 'http://localhost:3000';

function buildResponse(overrides: Partial<AiSuggestionsResponseDto> = {}): AiSuggestionsResponseDto {
    return {
        suggestions: [
            {
                gameId: 99,
                name: 'It Takes Two',
                coverUrl: null,
                confidence: 0.9,
                reasoning: 'Personal co-op pick',
                ownershipCount: 1,
                voterTotal: 1,
            },
        ],
        generatedAt: '2026-04-22T05:00:00.000Z',
        voterCount: 1,
        voterScopeStrategy: 'small_group',
        cached: false,
        ...overrides,
    };
}

describe('PersonalSuggestionsRow (ROK-931)', () => {
    it('sends ?personalize=me to the backend', async () => {
        const seen: URL[] = [];
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, ({ request }) => {
                seen.push(new URL(request.url));
                return HttpResponse.json(buildResponse());
            }),
        );
        renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={vi.fn()} />,
        );
        await waitFor(() => {
            expect(seen.length).toBeGreaterThan(0);
        });
        expect(seen[0].searchParams.get('personalize')).toBe('me');
    });

    it('renders nothing when suggestions is empty', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(buildResponse({ suggestions: [] })),
            ),
        );
        const { container } = renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={vi.fn()} />,
        );
        await waitFor(() => {
            expect(container.textContent).not.toContain('Suggested for you');
        });
    });

    it('fires onPickSuggestion with the DTO when the Pick button is clicked', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(buildResponse()),
            ),
        );
        const handlePick = vi.fn();
        renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={handlePick} />,
        );
        const pickButton = await screen.findByRole('button', { name: 'Pick' });
        const user = userEvent.setup();
        await user.click(pickButton);
        expect(handlePick).toHaveBeenCalledTimes(1);
        expect(handlePick).toHaveBeenCalledWith(
            expect.objectContaining({ gameId: 99, name: 'It Takes Two' }),
        );
    });

    it('lays out cards in a responsive grid (ROK-1114 round 3)', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(buildResponse()),
            ),
        );
        renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={vi.fn()} />,
        );
        const grid = await screen.findByTestId('personal-suggestions-grid');
        // Grid container — not flex/overflow-x — so mouse users can see all
        // suggestions without horizontal scroll inside the wider modal.
        expect(grid.className).toMatch(/\bgrid\b/);
        expect(grid.className).toMatch(/grid-cols-/);
    });
});

describe('PersonalSuggestionsRow — AI surface states (ROK-1114)', () => {
    it('renders "Suggestions temporarily unavailable" when AI returns 503', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json(
                    { error: 'AI_PROVIDER_UNAVAILABLE' },
                    { status: 503 },
                ),
            ),
        );
        renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={vi.fn()} />,
        );
        const message = await screen.findByText(
            /Suggestions temporarily unavailable/i,
        );
        expect(message).toBeInTheDocument();
        // Header still visible so the user knows what the section is for.
        expect(screen.getByText(/Suggested for you/i)).toBeInTheDocument();
    });

    it('renders "AI suggestions unavailable" when the query errors out', async () => {
        // Generic 500 — `getAiSuggestions` only special-cases 503, so a 500
        // surfaces as a generic query error (`query.isError === true`).
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json({ error: 'INTERNAL' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={vi.fn()} />,
        );
        const message = await screen.findByText(/AI suggestions unavailable/i);
        expect(message).toBeInTheDocument();
        expect(screen.getByText(/Suggested for you/i)).toBeInTheDocument();
    });

    it('renders the loading indicator while the suggestions query is pending', async () => {
        let resolve: ((v: Response) => void) | undefined;
        const pending = new Promise<Response>((r) => {
            resolve = r;
        });
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () => pending),
        );
        renderWithProviders(
            <PersonalSuggestionsRow lineupId={7} onPickSuggestion={vi.fn()} />,
        );
        const loading = await screen.findByText(/AI suggestions loading/i);
        expect(loading).toBeInTheDocument();
        // Cleanup the dangling promise so the test runner exits.
        resolve?.(HttpResponse.json(buildResponse({ suggestions: [] })));
        await waitFor(() => {
            expect(
                screen.queryByText(/AI suggestions loading/i),
            ).not.toBeInTheDocument();
        });
    });
});

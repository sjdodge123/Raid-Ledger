/**
 * Tests for PersonalSuggestionsRow (ROK-931).
 *
 * Verifies that the per-user "Suggested for you" row:
 *   - Calls the backend with `?personalize=me` (not the group-scope URL).
 *   - Renders nothing (null) on 503 or empty suggestions.
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

    it('renders nothing when the hook reports unavailable (503)', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/:id/suggestions`, () =>
                HttpResponse.json({ error: 'AI_PROVIDER_UNAVAILABLE' }, { status: 503 }),
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
});

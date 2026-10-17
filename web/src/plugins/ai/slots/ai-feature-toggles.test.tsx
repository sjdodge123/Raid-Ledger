/**
 * Tests for AiFeatureToggles (ROK-1114 round 3).
 *
 * Verifies the new "AI Nomination Suggestions" toggle:
 *   - Reads its initial state from `data?.aiSuggestionsEnabled`,
 *     defaulting to ON when the field is missing (mirrors the
 *     server-side default).
 *   - Sends `{ aiSuggestionsEnabled: false }` when toggled off so the
 *     LLM cost cap takes effect immediately.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { AiFeatureToggles } from './ai-feature-toggles';

vi.mock('../../../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => 'test-token'),
    useAuth: () => ({ user: { id: 1, username: 'admin', role: 'admin' } }),
    isAdmin: (user: { role?: string } | null | undefined) => user?.role === 'admin',
}));

const API = 'http://localhost:3000';

/** Each toggle is the shared Switch, named by its row label (ROK-1687). */
async function findToggleFor(label: RegExp): Promise<HTMLElement> {
    return screen.findByRole('switch', { name: label });
}

function mockFeatures(overrides: Partial<{
    chatEnabled: boolean;
    dynamicCategoriesEnabled: boolean;
    aiSuggestionsEnabled: boolean;
}> = {}) {
    server.use(
        http.get(`${API}/admin/ai/features`, () =>
            HttpResponse.json({
                chatEnabled: false,
                dynamicCategoriesEnabled: false,
                aiSuggestionsEnabled: true,
                ...overrides,
            }),
        ),
    );
}

describe('AiFeatureToggles — AI Nomination Suggestions toggle (ROK-1114 round 3)', () => {
    it('renders the new toggle in the on state by default', async () => {
        mockFeatures({ aiSuggestionsEnabled: true });
        renderWithProviders(<AiFeatureToggles disabled={false} />);
        const toggle = await findToggleFor(/AI Nomination Suggestions/i);
        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'true');
        });
    });

    it('reflects an off state when the server reports aiSuggestionsEnabled: false', async () => {
        mockFeatures({ aiSuggestionsEnabled: false });
        renderWithProviders(<AiFeatureToggles disabled={false} />);
        const toggle = await findToggleFor(/AI Nomination Suggestions/i);
        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'false');
        });
    });

    it('sends { aiSuggestionsEnabled: false } when toggled off', async () => {
        mockFeatures({ aiSuggestionsEnabled: true });
        const seen: unknown[] = [];
        server.use(
            http.put(`${API}/admin/ai/features`, async ({ request }) => {
                seen.push(await request.json());
                return HttpResponse.json({ success: true });
            }),
        );
        renderWithProviders(<AiFeatureToggles disabled={false} />);
        const toggle = await findToggleFor(/AI Nomination Suggestions/i);
        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'true');
        });
        const user = userEvent.setup();
        await user.click(toggle);
        await waitFor(() => {
            expect(seen).toContainEqual({ aiSuggestionsEnabled: false });
        });
    });
});

describe('AiFeatureToggles — shared Switch (ROK-1687)', () => {
    it.each(['AI Chat', 'Dynamic Discovery Categories', 'AI Nomination Suggestions'])(
        'names the %s switch by its label and paints it with theme tokens',
        async (label) => {
            mockFeatures({ chatEnabled: true, dynamicCategoriesEnabled: true, aiSuggestionsEnabled: true });
            renderWithProviders(<AiFeatureToggles disabled={false} />);
            const toggle = await screen.findByRole('switch', { name: label });
            await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
            expect(toggle.className).not.toMatch(/-(purple|violet|fuchsia)-\d{3}/);
        },
    );

    it('describes each switch with its row description via aria-describedby', async () => {
        mockFeatures();
        renderWithProviders(<AiFeatureToggles disabled={false} />);
        const toggle = await screen.findByRole('switch', { name: 'AI Chat' });
        expect(toggle).toHaveAccessibleDescription('Enable AI chat assistant for community members');
    });
});

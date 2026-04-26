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
}));

const API = 'http://localhost:3000';

/**
 * The toggle button has no accessible name (label/description sit in
 * sibling <p>'s) so we locate it by walking up from the label text to
 * the row container, then querying the row's switch.
 */
async function findToggleFor(label: RegExp): Promise<HTMLElement> {
    const labelEl = await screen.findByText(label);
    const row = labelEl.closest('div.flex.items-center');
    if (!row) throw new Error(`row for label ${label} not found`);
    const switchEl = row.querySelector('[role="switch"]');
    if (!switchEl) throw new Error(`switch for label ${label} not found`);
    return switchEl as HTMLElement;
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

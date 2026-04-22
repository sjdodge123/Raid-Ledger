/**
 * AiSuggestionsPanel tests (TDD FAILING, ROK-931).
 *
 * Spec AC line 256 — "CommonGroundPanel renders AiSuggestionsPanel with
 * loading / empty (hidden) / 503 (inline error) / success states (Vitest)".
 *
 * The "empty" case asserts the SECTION is absent from the DOM (not just
 * hidden via CSS) per spec UI States line 189.
 *
 * Component does not exist yet — import fails until Phase C lands.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { AiSuggestionsPanel } from './AiSuggestionsPanel';

const API = 'http://localhost:3000';

function stubSuggestions(status: number, body: unknown) {
  server.use(
    http.get(`${API}/lineups/:id/suggestions`, () =>
      HttpResponse.json(body, { status }),
    ),
  );
}

function stubSuggestionsLoading() {
  server.use(
    http.get(`${API}/lineups/:id/suggestions`, async () => {
      // Never resolve within the test lifetime so the component stays in
      // its loading state for the skeleton assertion.
      await delay('infinite');
      return HttpResponse.json({});
    }),
  );
}

const SUCCESS_PAYLOAD = {
  suggestions: [
    {
      gameId: 42,
      name: 'Valheim',
      coverUrl: '/cover-valheim.jpg',
      confidence: 0.9,
      reasoning: 'Strong co-op overlap with your group',
      ownershipCount: 3,
      voterTotal: 5,
    },
    {
      gameId: 43,
      name: 'Deep Rock Galactic',
      coverUrl: '/cover-drg.jpg',
      confidence: 0.8,
      reasoning: 'Shared survival + co-op taste axes',
      ownershipCount: 4,
      voterTotal: 5,
    },
  ],
  generatedAt: '2026-04-22T10:00:00.000Z',
  voterCount: 5,
  voterScopeStrategy: 'community',
  cached: false,
};

describe('AiSuggestionsPanel (ROK-931)', () => {
  beforeEach(() => {
    // Reset any lingering handlers between tests.
  });

  it('renders the loading skeleton while the request is in flight', () => {
    stubSuggestionsLoading();
    const { container } = renderWithProviders(
      <AiSuggestionsPanel lineupId={1} canParticipate={true} />,
    );
    // A loading state should render SOME skeleton — look for at least one
    // element with an animate-pulse class OR data-testid="ai-suggestions-skeleton".
    const skeleton =
      container.querySelector('[data-testid="ai-suggestions-skeleton"]') ??
      container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
  });

  it('hides the section entirely when suggestions array is empty', async () => {
    stubSuggestions(200, { ...SUCCESS_PAYLOAD, suggestions: [] });
    const { container } = renderWithProviders(
      <AiSuggestionsPanel lineupId={1} canParticipate={true} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="ai-suggestions-skeleton"]'),
      ).toBeNull();
    });
    // Section must be absent from the DOM (NOT just hidden via CSS).
    expect(screen.queryByText(/AI Suggestions/i)).not.toBeInTheDocument();
  });

  it('shows an inline "AI suggestions unavailable" message on 503', async () => {
    stubSuggestions(503, { error: 'AI_PROVIDER_UNAVAILABLE' });
    renderWithProviders(
      <AiSuggestionsPanel lineupId={1} canParticipate={true} />,
    );
    expect(
      await screen.findByText(/AI suggestions unavailable/i),
    ).toBeInTheDocument();
  });

  it('renders the AI Suggestions header and cards on success', async () => {
    stubSuggestions(200, SUCCESS_PAYLOAD);
    renderWithProviders(
      <AiSuggestionsPanel lineupId={1} canParticipate={true} />,
    );
    expect(await screen.findByText(/AI Suggestions/i)).toBeInTheDocument();
    expect(await screen.findByText('Valheim')).toBeInTheDocument();
    expect(screen.getByText('Deep Rock Galactic')).toBeInTheDocument();
    // Ownership pill surfaces "X/Y own" style text.
    expect(screen.getByText(/3\s*\/\s*5/)).toBeInTheDocument();
  });
});

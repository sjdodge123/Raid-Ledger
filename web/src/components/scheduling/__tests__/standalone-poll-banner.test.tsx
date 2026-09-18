/**
 * ROK-1609 — "Active scheduling polls" only lists polls you can still vote on.
 *
 * The operator's events page advertised PEAK and Valheim with "Vote →" while
 * both poll pages rendered ■ POLL EXPIRED: `findActiveStandalonePolls` had no
 * deadline filter. The fix is server-side — the list simply stops carrying an
 * expired poll — so these cases pin the contract from the web side: whatever
 * the endpoint returns is rendered with "Vote →", and an empty list (every
 * poll expired) renders no banner at all rather than an empty cyan box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { ActiveStandalonePollDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';

const activePolls = vi.fn<[], ActiveStandalonePollDto[] | undefined>(() => []);
vi.mock('../../../hooks/use-standalone-poll', () => ({
  useActiveStandalonePolls: () => ({
    data: activePolls(),
    isLoading: false,
  }),
}));

import { StandalonePollBanner } from '../standalone-poll-banner';

/** One active-poll row as the endpoint returns it. */
function buildPoll(
  overrides: Partial<ActiveStandalonePollDto> = {},
): ActiveStandalonePollDto {
  return {
    matchId: 500,
    lineupId: 7,
    gameName: 'Valheim',
    gameCoverUrl: null,
    memberCount: 12,
    slotCount: 6,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  activePolls.mockReturnValue([]);
});

describe('StandalonePollBanner (ROK-1609)', () => {
  it('AC2 — an open poll is listed with a Vote link', () => {
    activePolls.mockReturnValue([buildPoll()]);
    renderWithProviders(<StandalonePollBanner />);

    expect(screen.getByTestId('standalone-poll-banner')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Valheim/ });
    expect(link).toHaveAttribute(
      'href',
      '/community-lineup/7/schedule/500',
    );
    expect(link).toHaveTextContent('Vote →');
  });

  it('AC1 — an expired poll is not listed: the server filters it out, and a list with only expired polls renders no banner', () => {
    // The endpoint now excludes past-deadline polls, so the expired PEAK and
    // Valheim polls arrive as an empty list.
    activePolls.mockReturnValue([]);
    renderWithProviders(<StandalonePollBanner />);

    expect(screen.queryByTestId('standalone-poll-banner')).toBeNull();
    expect(screen.queryByText(/Vote →/)).toBeNull();
    expect(screen.queryByText(/Active scheduling polls/i)).toBeNull();
  });

  it('renders nothing while the list is still loading or unavailable', () => {
    activePolls.mockReturnValue(undefined);
    renderWithProviders(<StandalonePollBanner />);

    expect(screen.queryByTestId('standalone-poll-banner')).toBeNull();
  });

  it('lists every poll the endpoint still considers active', () => {
    activePolls.mockReturnValue([
      buildPoll(),
      buildPoll({ matchId: 501, lineupId: 8, gameName: 'PEAK', slotCount: 1 }),
    ]);
    renderWithProviders(<StandalonePollBanner />);

    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('1 slot')).toBeInTheDocument();
    expect(screen.getByText('6 slots')).toBeInTheDocument();
  });
});

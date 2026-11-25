/**
 * TDD tests for SteamNudgeBanner (ROK-993).
 * Validates the dismissible "Link Steam" banner shown to unlinked users
 * during the building phase of a lineup.
 *
 * These tests are written BEFORE the component exists.
 * They MUST fail until the dev agent builds the component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { SteamNudgeBanner } from './SteamNudgeBanner';
import { blockWebStorage } from '../../test/block-web-storage';

// Mock auth hook to control user.steamId and role
vi.mock('../../hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: 'member', username: 'TestUser' },
  })),
  isOperatorOrAdmin: vi.fn(() => false),
}));

// Mock Steam link hook to capture linkSteam calls
const mockLinkSteam = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/use-steam-link', () => ({
  useSteamLink: vi.fn(() => ({
    linkSteam: mockLinkSteam,
    isLinkPending: false,
  })),
}));

import { useAuth } from '../../hooks/use-auth';

const mockUseAuth = vi.mocked(useAuth);

describe('SteamNudgeBanner — visible states', () => {
  beforeEach(() => {
    localStorage.clear();
    mockLinkSteam.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'member', username: 'TestUser' } as never,
    } as never);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders when user has no steamId and lineup is building', () => {
    renderWithProviders(
      <SteamNudgeBanner
        lineupId={42}
        lineupStatus="building"
        userSteamId={null}
      />,
    );

    expect(screen.getByText(/link.*steam/i)).toBeInTheDocument();
  });

  it('hidden when user has steamId', () => {
    const { container } = renderWithProviders(
      <SteamNudgeBanner
        lineupId={42}
        lineupStatus="building"
        userSteamId="76561198000000001"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('hidden when lineup status is not building', () => {
    const { container } = renderWithProviders(
      <SteamNudgeBanner
        lineupId={42}
        lineupStatus="voting"
        userSteamId={null}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('SteamNudgeBanner — dismiss behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    mockLinkSteam.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'member', username: 'TestUser' } as never,
    } as never);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('dismiss button hides banner and persists in localStorage', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SteamNudgeBanner
        lineupId={42}
        lineupStatus="building"
        userSteamId={null}
      />,
    );

    const dismissBtn = screen.getByRole('button', { name: /dismiss|close/i });
    await user.click(dismissBtn);

    expect(screen.queryByText(/link.*steam/i)).not.toBeInTheDocument();
    expect(
      localStorage.getItem('raid_ledger_steam_nudge_dismissed_42'),
    ).toBeTruthy();
  });

  it('stays hidden when localStorage dismiss key is already set', () => {
    localStorage.setItem('raid_ledger_steam_nudge_dismissed_42', 'true');

    const { container } = renderWithProviders(
      <SteamNudgeBanner
        lineupId={42}
        lineupStatus="building"
        userSteamId={null}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('SteamNudgeBanner — CTA', () => {
  beforeEach(() => {
    localStorage.clear();
    mockLinkSteam.mockReset().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'member', username: 'TestUser' } as never,
    } as never);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('CTA button calls linkSteam when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SteamNudgeBanner
        lineupId={42}
        lineupStatus="building"
        userSteamId={null}
      />,
    );

    const ctaButton = screen.getByRole('button', { name: /link.*steam/i });
    await user.click(ctaButton);

    expect(mockLinkSteam).toHaveBeenCalled();
  });
});

describe('SteamNudgeBanner — browser blocks storage (TECH-DEBT L4009)', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    mockLinkSteam.mockReset().mockResolvedValue(undefined);
    restore = blockWebStorage();
  });

  afterEach(() => restore());

  it('renders (a blocked dismissal read counts as not dismissed)', () => {
    renderWithProviders(
      <SteamNudgeBanner lineupId={42} lineupStatus="building" userSteamId={null} />,
    );

    expect(screen.getByText(/link.*steam/i)).toBeInTheDocument();
  });

  it('dismiss still hides the banner for this page', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SteamNudgeBanner lineupId={42} lineupStatus="building" userSteamId={null} />,
    );

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText(/link.*steam/i)).not.toBeInTheDocument();
  });

  // ROK-2319: `dark:` follows the OS, not the app scheme — the banner must paint from tokens only,
  // and the dismiss × must be a 44px phone target (it was 9×20).
  it('paints from scheme tokens with no dark: variant or raw blue, and gives dismiss a 44px target', () => {
    renderWithProviders(
      <SteamNudgeBanner lineupId={7} lineupStatus="building" userSteamId={null} />,
    );
    const banner = screen.getByText(/Connect your account/).parentElement;
    if (!banner) throw new Error('banner container missing');
    expect(banner).toHaveClass('border-edge', 'bg-overlay/30', 'text-secondary');
    const classes = [banner, ...Array.from(banner.querySelectorAll('*'))].map((el) => el.getAttribute('class') ?? '').join(' ');
    expect(classes).not.toMatch(/(?:^|\s)dark:/);
    expect(classes).not.toMatch(/\b(?:bg|text|border)-blue-\d/);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });
});

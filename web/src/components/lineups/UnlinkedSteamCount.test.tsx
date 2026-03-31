/**
 * TDD tests for UnlinkedSteamCount (ROK-993).
 * Validates operator-visible unlinked member count display
 * on the lineup detail page during building phase.
 *
 * These tests are written BEFORE the component exists.
 * They MUST fail until the dev agent builds the component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { UnlinkedSteamCount } from './UnlinkedSteamCount';

// Mock auth hook to control user role
vi.mock('../../hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: 'operator', username: 'Admin' },
  })),
  isOperatorOrAdmin: vi.fn(() => true),
}));

import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

const mockUseAuth = vi.mocked(useAuth);
const mockIsOperatorOrAdmin = vi.mocked(isOperatorOrAdmin);

describe('UnlinkedSteamCount — operator visibility', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'operator', username: 'Admin' } as never,
    } as never);
    mockIsOperatorOrAdmin.mockReturnValue(true);
  });

  it('renders count for operator users when count > 0', () => {
    renderWithProviders(
      <UnlinkedSteamCount count={5} />,
    );

    expect(screen.getByText(/5/)).toBeInTheDocument();
    expect(screen.getByText(/unlinked|without steam/i)).toBeInTheDocument();
  });

  it('hidden when count is 0', () => {
    const { container } = renderWithProviders(
      <UnlinkedSteamCount count={0} />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('UnlinkedSteamCount — non-operator visibility', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, role: 'member', username: 'RegularUser' } as never,
    } as never);
    mockIsOperatorOrAdmin.mockReturnValue(false);
  });

  it('hidden for regular users even when count > 0', () => {
    const { container } = renderWithProviders(
      <UnlinkedSteamCount count={5} />,
    );

    expect(container.firstChild).toBeNull();
  });
});

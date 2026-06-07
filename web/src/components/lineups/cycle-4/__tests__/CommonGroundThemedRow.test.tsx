/**
 * Tests for CommonGroundThemedRow's per-tile nominate button (ROK-1349).
 *
 * Pins the three distinct disabled-reason labels the bug conflated:
 *   (a) genuine nomination cap → "Nomination cap reached"
 *   (b) view-only non-invitee → "View only"
 *   (c) nominatable           → "+ Nominate"
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { CommonGroundThemedRow } from '../CommonGroundThemedRow';

function buildTile(
  overrides: Partial<CommonGroundGameDto> = {},
): CommonGroundGameDto {
  return {
    gameId: 1,
    gameName: 'Valheim',
    slug: 'valheim',
    coverUrl: null,
    ownerCount: 3,
    wishlistCount: 0,
    nonOwnerPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    earlyAccess: false,
    itadTags: [],
    playerCount: null,
    score: 30,
    theme: 'owned',
    whyReason: 'why',
    ...overrides,
  };
}

function renderRow(opts: { atCap: boolean; canParticipate: boolean }) {
  render(
    <CommonGroundThemedRow
      theme="owned"
      tiles={[buildTile()]}
      atCap={opts.atCap}
      canParticipate={opts.canParticipate}
      nominatingId={null}
      onTileNominate={vi.fn()}
      onTileOpenDrawer={vi.fn()}
      aiSuggestionsByGameId={new Map()}
    />,
  );
}

describe('CommonGroundThemedRow nominate button (ROK-1349)', () => {
  it('renders "+ Nominate" enabled when nominatable', () => {
    renderRow({ atCap: false, canParticipate: true });
    const btn = screen.getByTestId('common-ground-tile-nominate');
    expect(btn).toHaveTextContent('+ Nominate');
    expect(btn).not.toBeDisabled();
  });

  it('renders the cap label when the lineup is at its nomination cap', () => {
    renderRow({ atCap: true, canParticipate: true });
    const btn = screen.getByTestId('common-ground-tile-nominate');
    expect(btn).toHaveTextContent('Nomination cap reached');
    expect(btn).toBeDisabled();
  });

  it('renders the view-only label for a non-invitee when under cap', () => {
    renderRow({ atCap: false, canParticipate: false });
    const btn = screen.getByTestId('common-ground-tile-nominate');
    expect(btn).toHaveTextContent('View only');
    expect(btn).not.toHaveTextContent('Nomination cap reached');
    expect(btn).toBeDisabled();
  });
});

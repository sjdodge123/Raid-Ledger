/**
 * ROK-1726 (AC10, D7): the Armory link-out is data-driven — the API builds
 * `profileUrl` only for retail Armory imports, so a manual (realmless) or
 * WoW: Forever character gets no "View on Armory" link. Pin it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CharacterDetailHeaderBadges } from './character-detail-header-badges';

const BASE = { faction: 'horde', itemLevel: null, equippedItemLevel: null, lastSyncedAt: null };

describe('CharacterDetailHeaderBadges — Armory link', () => {
    it('renders no "View on Armory" link when profileUrl is null', () => {
        render(<CharacterDetailHeaderBadges {...BASE} profileUrl={null} />);
        expect(screen.queryByText(/view on armory/i)).toBeNull();
    });

    it('links to the Armory when profileUrl is set', () => {
        const url = 'https://worldofwarcraft.blizzard.com/en-us/character/us/illidan/thrall';
        render(<CharacterDetailHeaderBadges {...BASE} profileUrl={url} />);
        expect(screen.getByRole('link', { name: /view on armory/i }).getAttribute('href')).toBe(url);
    });
});

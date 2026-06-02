import type { JSX } from 'react';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { UnifiedGameCard } from './unified-game-card';

/**
 * ROK-1295 — desktop discovery-page card.
 *
 * Renders the UnifiedGameCard (Link → /games/:id, heart toggle, info bar).
 * The card body navigates to the full game page, which is the desktop research
 * surface.
 *
 * ROK-1342 (operator decision 2026-06-02): the sibling ⓘ research-drawer
 * trigger was removed — discover cards carry NO (i) affordance on any
 * breakpoint. Desktop research is the full /games/:id page (one click away via
 * the card body); mobile uses DrawerCard (whole-card tap → drawer).
 */
interface GameDiscoverCardProps {
    game: GameDetailDto;
    pricing: ItadGamePricingDto | null;
}

export function GameDiscoverCard({ game, pricing }: GameDiscoverCardProps): JSX.Element {
    return (
        <UnifiedGameCard variant="link" game={game} compact showRating showInfoBar pricing={pricing} />
    );
}

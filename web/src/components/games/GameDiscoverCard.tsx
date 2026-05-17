import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { UnifiedGameCard } from './unified-game-card';
import { GameResearchDrawer } from './GameResearchDrawer';

/**
 * ROK-1295 — desktop discovery-page card.
 *
 * Wraps the existing UnifiedGameCard (Link → /games/:id, heart toggle, info bar)
 * with a sibling ⓘ button that is the EXCLUSIVE trigger for the universal Game
 * Research Drawer. The card body still navigates to the full game page so the
 * existing /games UX (heart, detail view) is preserved.
 *
 * Mobile uses DrawerCard instead (whole-card tap → drawer). The split exists
 * because a 480px+ side panel feels heavy on desktop where the full /games/:id
 * page is one click away.
 */
interface GameDiscoverCardProps {
    game: GameDetailDto;
    pricing: ItadGamePricingDto | null;
}

export function GameDiscoverCard({ game, pricing }: GameDiscoverCardProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    return (
        <div className="relative">
            <UnifiedGameCard variant="link" game={game} compact showRating showInfoBar pricing={pricing} />
            <ResearchTriggerButton gameName={game.name} onOpen={open} />
            <GameResearchDrawer isOpen={isOpen} onClose={close} gameId={game.id} />
        </div>
    );
}

function ResearchTriggerButton({
    gameName,
    onOpen,
}: {
    gameName: string;
    onOpen: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid="game-ref-info-affordance"
            aria-label={`Research ${gameName}`}
            title="Open game research"
            onClick={onOpen}
            className="absolute top-2 left-2 z-20 w-8 h-8 inline-flex items-center justify-center rounded-full bg-black/65 hover:bg-black/85 text-white text-sm font-semibold ring-1 ring-white/15 hover:ring-emerald-400/60 transition-colors"
        >
            i
        </button>
    );
}

/**
 * ROK-1927 — the "Attunements" card's header action: a ghost `sm` "See who"
 * (44px on phone via `buttonClass`) that opens the per-member detail. Hidden
 * while the dataset has no trackable attunement (there is nobody to list). Imported
 * eagerly by `attunements.register.ts`: it reads only the shared roster
 * insights query and the detail store, never the detail chunk.
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { attunementTabs } from './attunement-detail.helpers';
import { useAttunementsDetail } from './attunements-detail-store';
import { useRosterInsights } from './use-roster-insights';

/** The presentational button; `onOpenDetail` opens the P5 detail. */
export function SeeWhoButton({ onOpenDetail }: { onOpenDetail: () => void }): JSX.Element {
    return (
        <Button variant="ghost" size="sm" data-testid="attunements-see-who" onClick={onOpenDetail}>
            See who
        </Button>
    );
}

/** Header action: wires "See who" to the detail store for this hub. */
export function AttunementsAction({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useRosterInsights(guildId, false);
    const open = useAttunementsDetail((s) => s.open);
    const attunements = data?.attunements;
    // Only trackable groups have members to list (an all-untracked payload is the §7 empty state).
    if (attunements === undefined || attunementTabs(attunements.attunements).length === 0) return null;
    return <SeeWhoButton onOpenDetail={() => open(guildId)} />;
}

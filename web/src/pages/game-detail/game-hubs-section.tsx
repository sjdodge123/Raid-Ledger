/**
 * ROK-1883 — the game page's one "Hubs" card (spec §2.4): every hub kind of
 * this game the viewer may see (WoW guilds, game servers, community hubs),
 * each once with its kind chip. Every hub the viewer is in, then others up to
 * three, then "See all N hubs" into `/hubs`. Keeps ROK-1870's inline Join,
 * "Your proposals" and "Start a community hub". Replaces the WoW "Guilds"
 * card and the "Community hubs" card.
 */
import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GameHubs } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { useGameHubs, useJoinGameHub } from './use-game-hubs';
import { ProposeHubDialog } from './propose-hub-dialog';
import { GameHubRow } from './game-hub-row';
import { GameHubsProposals, GameHubsStartFooter } from './game-hubs-proposals';
import { pickShownHubs, uniqueHubs } from './game-hubs-shown';

const FRAME = 'mb-8 rounded-lg border border-edge bg-surface p-4';
const HEADING_ID = 'game-hubs-heading';

function Heading(): JSX.Element {
    return <h2 id={HEADING_ID} className="text-lg font-semibold text-foreground">Hubs</h2>;
}

function HubList({ data, gameId, gameName }: { data: GameHubs; gameId: number; gameName: string }): JSX.Element {
    const join = useJoinGameHub(gameId);
    // `data.total` counts every visible hub, past the 50-row payload cap (Codex P2).
    const total = Math.max(data.total, uniqueHubs(data.hubs).length);
    if (total === 0) {
        return <p className="mt-2 text-sm text-muted">No hubs for {gameName} yet — start the first community hub.</p>;
    }
    const shown = pickShownHubs(data.hubs);
    return (
        <>
            <ul className="mt-1 divide-y divide-edge-subtle">
                {shown.map((h) => (
                    <GameHubRow key={h.id} hub={h} onJoin={() => join.mutate(h.id)} joining={join.isPending && join.variables === h.id} />
                ))}
            </ul>
            {total > shown.length && (
                <Link to={`/hubs?game=${gameId}`} className="mt-1 inline-block text-sm text-secondary underline">See all {total} hubs</Link>
            )}
        </>
    );
}

/** The card frame with a §4.5 error line when `/hubs/by-game` fails. */
function HubsCardError({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <section className={FRAME} aria-labelledby={HEADING_ID}>
            <Heading />
            <p role="alert" data-testid="game-hubs-error" className="mt-2 flex items-center gap-2 text-sm text-muted">
                Couldn’t load hubs. <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
            </p>
        </section>
    );
}

/** Core game-page section; renders nothing while loading, an error line on failure. */
export function GameHubsSection({ gameId, gameName }: { gameId: number; gameName: string }): JSX.Element | null {
    const { data, isError, refetch } = useGameHubs(gameId);
    const [open, setOpen] = useState(false);
    if (isError) return <HubsCardError onRetry={() => void refetch()} />;
    if (!data) return null;
    return (
        <section className={FRAME} aria-labelledby={HEADING_ID}>
            <Heading />
            <HubList data={data} gameId={gameId} gameName={gameName} />
            <GameHubsProposals proposals={data.myProposals} />
            <GameHubsStartFooter data={data} onStart={() => setOpen(true)} />
            <ProposeHubDialog isOpen={open} onClose={() => setOpen(false)} gameId={gameId} gameName={gameName} />
        </section>
    );
}

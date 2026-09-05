/**
 * The tie readiness card (ROK-1374).
 *
 * A completed vote with no decidable winner used to be a dead end. The card
 * takes the slot the grace banner vacated and turns the tie into a comparison
 * the group can act on: who owns what, how big it is, how long it takes to
 * download — and one human clicking a game. It never selects a winner itself.
 */
import { useState, type JSX } from 'react';
import type { TieReadinessGameDto } from '@raid-ledger/contract';
import { useTieReadiness } from '../../../hooks/use-tie-readiness';
import { useConnectionSpeed } from '../../../hooks/use-connection-speed';
import { useAutoSpeedTest } from '../../../hooks/use-auto-speed-test';
import { TieReadinessRow } from './TieReadinessRow';
import { TiePickControls } from './TiePickControls';
import { InstallSizeEntryModal } from './InstallSizeEntryModal';
import { ConnectionSpeedConsentModal } from './ConnectionSpeedConsentModal';
import { formatAutoSpeedSkip, formatExpiry } from './tie-format.helpers';

interface Props {
    lineupId: number;
}

/** Vote count + deadline — the "why am I looking at this" line. */
function CardHeader({
    voteCount,
    expiresAt,
}: {
    voteCount: number;
    expiresAt: string | null;
}): JSX.Element {
    const expiry = formatExpiry(expiresAt);
    return (
        <div className="mb-3">
            <h3 className="text-base font-semibold text-foreground">
                Tied — {voteCount} votes each
            </h3>
            <p className="text-sm text-muted">
                Compare them below, then someone picks
                {expiry ? ` · expires ${expiry}` : ''}
            </p>
        </div>
    );
}

/** The comparison card, or nothing at all when no tie hold exists (AC7). */
export function TieReadinessCard({ lineupId }: Props): JSX.Element | null {
    const { data } = useTieReadiness(lineupId);
    const { data: speed } = useConnectionSpeed();
    const [sizeGame, setSizeGame] = useState<TieReadinessGameDto | null>(null);
    const [speedModalOpen, setSpeedModalOpen] = useState(false);
    const autoSpeedRefusal = useAutoSpeedTest(speed, !!data);

    if (!data || data.status === 'none') return null;
    // The refusal explains why the AUTOMATIC measurement did not run — it is
    // just as true for a stale figure the guard declined to refresh (E17).
    const speedNote = formatAutoSpeedSkip(autoSpeedRefusal);
    return (
        <section
            aria-label="Tie readiness"
            className="mb-4 rounded-lg border border-amber-700/60 bg-surface p-4"
        >
            <CardHeader voteCount={data.voteCount} expiresAt={data.expiresAt} />
            <ul className="mb-3 space-y-2">
                {data.games.map((game) => (
                    <TieReadinessRow
                        key={game.gameId}
                        game={game}
                        rosterSize={data.rosterSize}
                        viewerSpeedMbps={data.viewerSpeedMbps}
                        onAddSize={setSizeGame}
                        onAddSpeed={() => setSpeedModalOpen(true)}
                    />
                ))}
            </ul>
            {speedNote && <p className="mb-3 text-sm text-muted">{speedNote}</p>}
            <TiePickControls
                lineupId={lineupId}
                games={data.games}
                canPick={data.canPick && data.status !== 'expired'}
                pick={data.pick}
                pickerName={data.pickerName}
                expiresAt={data.expiresAt}
            />
            {sizeGame && (
                <InstallSizeEntryModal
                    lineupId={lineupId}
                    game={sizeGame}
                    isOpen
                    onClose={() => setSizeGame(null)}
                />
            )}
            <ConnectionSpeedConsentModal
                isOpen={speedModalOpen}
                onClose={() => setSpeedModalOpen(false)}
                speed={speed}
            />
        </section>
    );
}

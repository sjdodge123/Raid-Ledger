/**
 * One tied game on the readiness card (ROK-1374).
 *
 * Three blocks, in decreasing order of how often they decide a tie: who owns
 * it, how big it is, and how long EACH ROSTER MEMBER would wait for it
 * (operator ruling 2026-09-05 — a tie is decided together). Only the first is
 * guaranteed to exist — the others degrade to an invitation, never an error
 * (D12 / AC22).
 */
import type { JSX } from 'react';
import type { TieReadinessGameDto } from '@raid-ledger/contract';
import { formatOwnershipLine, formatSizeLine } from './tie-format.helpers';
import { RosterEtaList } from './roster-eta-list';

interface Props {
    game: TieReadinessGameDto;
    rosterSize: number;
    viewerSpeedMbps: number | null;
    onAddSize: (game: TieReadinessGameDto) => void;
    onAddSpeed: () => void;
}

/** The size line, or the "Size unknown · Add it" affordance. */
function SizeLine({ game, onAddSize }: Pick<Props, 'game' | 'onAddSize'>): JSX.Element {
    const line = formatSizeLine(
        game.downloadSizeBytes ?? game.installSizeBytes,
        game.installSizeSource,
        game.installSizeUpdatedAt,
    );
    if (line) return <p className="text-sm text-muted">{line}</p>;
    return (
        <p className="text-sm text-muted">
            Size unknown ·{' '}
            <button
                type="button"
                onClick={() => onAddSize(game)}
                className="underline hover:text-foreground"
            >
                Add it
            </button>
        </p>
    );
}

/** A single tied game's readiness summary. */
export function TieReadinessRow(props: Props): JSX.Element {
    const { game, rosterSize, viewerSpeedMbps, onAddSize, onAddSpeed } = props;
    return (
        <li className="rounded-lg border border-edge bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-semibold text-foreground">{game.gameName}</h4>
                <span className="text-xs text-muted">{game.voteCount} votes</span>
            </div>
            <p className="text-sm text-muted">
                {formatOwnershipLine(game.ownedCount, rosterSize)}
                {game.youOwn ? ' · You own it' : ' · You do not own it'}
            </p>
            <SizeLine game={game} onAddSize={onAddSize} />
            <RosterEtaList
                etas={game.rosterEtas}
                viewerSpeedMbps={viewerSpeedMbps}
                onAddSpeed={onAddSpeed}
            />
        </li>
    );
}

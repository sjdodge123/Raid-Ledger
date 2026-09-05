/**
 * One tied game on the readiness card (ROK-1374).
 *
 * Three lines, in decreasing order of how often they decide a tie: who owns it,
 * how big it is, and how long the viewer would wait for it. Only the first is
 * guaranteed to exist — the other two degrade to an invitation, never an error
 * (D12 / AC22).
 */
import type { JSX } from 'react';
import type { TieReadinessGameDto } from '@raid-ledger/contract';
import {
    formatEstimateLine,
    formatOwnershipLine,
    formatSizeLine,
} from './tie-format.helpers';

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
    if (line) return <p className="text-sm text-gray-400">{line}</p>;
    return (
        <p className="text-sm text-gray-400">
            Size unknown ·{' '}
            <button
                type="button"
                onClick={() => onAddSize(game)}
                className="underline hover:text-gray-200"
            >
                Add it
            </button>
        </p>
    );
}

/** The download estimate, or the invitation to supply a speed. Never "0 min". */
function EstimateLine({
    game,
    viewerSpeedMbps,
    onAddSpeed,
}: Pick<Props, 'game' | 'viewerSpeedMbps' | 'onAddSpeed'>): JSX.Element | null {
    const line = formatEstimateLine(game.estimatedDownloadMinutes, viewerSpeedMbps);
    if (line) return <p className="text-sm text-gray-400">{line}</p>;
    if (viewerSpeedMbps !== null) return null;
    return (
        <p className="text-sm text-gray-400">
            <button
                type="button"
                onClick={onAddSpeed}
                className="underline hover:text-gray-200"
            >
                Add your connection speed
            </button>
        </p>
    );
}

/** A single tied game's readiness summary. */
export function TieReadinessRow(props: Props): JSX.Element {
    const { game, rosterSize, viewerSpeedMbps, onAddSize, onAddSpeed } = props;
    return (
        <li className="rounded-lg border border-gray-700 bg-gray-800/60 p-3">
            <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-semibold text-gray-100">{game.gameName}</h4>
                <span className="text-xs text-gray-400">{game.voteCount} votes</span>
            </div>
            <p className="text-sm text-gray-300">
                {formatOwnershipLine(game.ownedCount, rosterSize)}
                {game.youOwn ? ' · You own it' : ' · You do not own it'}
            </p>
            <SizeLine game={game} onAddSize={onAddSize} />
            <EstimateLine
                game={game}
                viewerSpeedMbps={viewerSpeedMbps}
                onAddSpeed={onAddSpeed}
            />
        </li>
    );
}

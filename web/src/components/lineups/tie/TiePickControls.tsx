/**
 * The pick affordance on the readiness card (ROK-1374, D16 / E20).
 *
 * The card itself is visible to every roster member — only this control is
 * gated. Everyone else reads who the group is waiting on, which is what turns
 * a silent dead-end into a social nudge.
 */
import { useEffect, useState, type JSX } from 'react';
import type { TieReadinessGameDto, TiePickDto } from '@raid-ledger/contract';
import { usePickTieGame, useUndoTiePick } from '../../../hooks/use-tie-readiness';
import { formatExpiry } from './tie-format.helpers';

interface Props {
    lineupId: number;
    games: TieReadinessGameDto[];
    canPick: boolean;
    pick: TiePickDto | null;
    pickerName: string | null;
    expiresAt: string | null;
}

/** Seconds left until `iso`, re-rendered every second. Null once it is past. */
function useSecondsUntil(iso: string | null): number | null {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!iso) return;
        const id = setInterval(() => setTick((n) => n + 1), 1_000);
        return () => clearInterval(id);
    }, [iso]);
    if (!iso) return null;
    const remaining = Math.ceil((new Date(iso).getTime() - Date.now()) / 1_000);
    return remaining > 0 ? remaining : null;
}

/** The picked state: what was chosen, when it locks in, and the undo. */
function PickedState(
    { lineupId, games, canPick, pick }: Props & { pick: TiePickDto },
): JSX.Element {
    const undo = useUndoTiePick(lineupId);
    const seconds = useSecondsUntil(pick.finalAt);
    const name = games.find((g) => g.gameId === pick.gameId)?.gameName ?? 'that game';
    return (
        <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-200">
                {pick.byUsername} picked {name}
                {seconds !== null ? ` · locks in ${seconds}s` : ' · locking in'}
            </p>
            {canPick && seconds !== null && (
                <button
                    type="button"
                    onClick={() => undo.mutate()}
                    disabled={undo.isPending}
                    className="rounded border border-gray-600 px-3 py-1 text-sm text-gray-200 hover:bg-gray-700"
                >
                    Undo
                </button>
            )}
        </div>
    );
}

/** One Pick button per tied game, or the line naming who everyone waits on. */
export function TiePickControls(props: Props): JSX.Element {
    const { lineupId, games, canPick, pick, pickerName, expiresAt } = props;
    const choose = usePickTieGame(lineupId);
    if (pick) return <PickedState {...props} pick={pick} />;
    if (!canPick) {
        const expiry = formatExpiry(expiresAt);
        return (
            <p className="text-sm text-gray-300">
                Waiting on {pickerName ?? 'the lineup creator'} to pick
                {expiry ? ` · expires ${expiry}` : ''}
            </p>
        );
    }
    return (
        <div className="flex flex-wrap gap-2">
            {games.map((game) => (
                <button
                    key={game.gameId}
                    type="button"
                    onClick={() => choose.mutate(game.gameId)}
                    disabled={choose.isPending}
                    className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                    Pick {game.gameName}
                </button>
            ))}
        </div>
    );
}

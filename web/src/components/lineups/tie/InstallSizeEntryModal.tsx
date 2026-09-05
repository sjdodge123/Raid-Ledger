/**
 * Hand-entry of a game's download footprint (ROK-1374, D11 / E15).
 *
 * The modal links OUT to SteamDB's depots page and asks a human to type what
 * they saw there. This app never fetches SteamDB: no proxy, no cron, no
 * user-agent (AC23). Without a Steam app id there is simply no link — the
 * field still works, because plenty of games are sized from somewhere else.
 */
import { useState, type JSX } from 'react';
import { SetInstallSizeSchema, type TieReadinessGameDto } from '@raid-ledger/contract';
import { Modal } from '../../ui/modal';
import { useSetInstallSize } from '../../../hooks/use-tie-readiness';

interface Props {
    lineupId: number;
    game: TieReadinessGameDto;
    isOpen: boolean;
    onClose: () => void;
}

/** The SteamDB deep link, when the game has a Steam app id. */
function SteamDbLink({ steamAppId }: { steamAppId: number | null }): JSX.Element | null {
    if (steamAppId === null) return null;
    return (
        <a
            href={`https://steamdb.info/app/${steamAppId}/depots/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-emerald-400 underline"
        >
            Look it up on SteamDB
        </a>
    );
}

/** Convert the typed GB figure to whole bytes, or null when unusable. */
function toBytes(raw: string): number | null {
    const gb = Number.parseFloat(raw);
    if (!Number.isFinite(gb) || gb <= 0) return null;
    return Math.round(gb * 1_000_000_000);
}

/** Ask for a size in GB and record it for everyone. */
export function InstallSizeEntryModal(props: Props): JSX.Element {
    const { lineupId, game, isOpen, onClose } = props;
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const save = useSetInstallSize(lineupId);

    const submit = (): void => {
        const parsed = SetInstallSizeSchema.safeParse({
            installSizeBytes: toBytes(value),
            downloadSizeBytes: null,
        });
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Enter a size in GB');
            return;
        }
        save.mutate({ gameId: game.gameId, body: parsed.data }, { onSuccess: onClose });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Size for ${game.gameName}`}>
            <div className="space-y-3">
                <p className="text-sm text-muted">
                    Type the install size you see on the store or depots page.
                    Everyone on the roster sees the number you enter, and it is what
                    the download estimate is worked out from until a separate download
                    size is known — so an install size is worth entering even when the
                    download is smaller.
                </p>
                <SteamDbLink steamAppId={game.steamAppId} />
                <label className="block text-sm text-muted" htmlFor="tie-size-gb">
                    Install size (GB)
                </label>
                <input
                    id="tie-size-gb"
                    type="number"
                    min="0"
                    step="0.1"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="w-full rounded border border-edge bg-surface px-2 py-1 text-foreground"
                />
                {error && <p className="text-sm text-amber-400">{error}</p>}
                <button
                    type="button"
                    onClick={submit}
                    disabled={save.isPending}
                    className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                >
                    Save size
                </button>
            </div>
        </Modal>
    );
}

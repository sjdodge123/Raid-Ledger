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
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
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
            className="text-sm text-success underline"
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

/** Validate the typed GB figure and save it; the error is shown inline on the field. */
function useSizeSubmit(lineupId: number, gameId: number, value: string, onSaved: () => void) {
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
        save.mutate({ gameId, body: parsed.data }, { onSuccess: onSaved });
    };
    return { submit, error, isPending: save.isPending };
}

/** Why the number matters — it drives the roster's download estimate. */
function SizeIntro(): JSX.Element {
    return (
        <p className="text-sm text-muted">
            Type the install size you see on the store or depots page.
            Everyone on the roster sees the number you enter, and it is what
            the download estimate is worked out from until a separate download
            size is known — so an install size is worth entering even when the
            download is smaller.
        </p>
    );
}

/** Ask for a size in GB and record it for everyone. */
export function InstallSizeEntryModal(props: Props): JSX.Element {
    const { lineupId, game, isOpen, onClose } = props;
    const [value, setValue] = useState('');
    const { submit, error, isPending } = useSizeSubmit(lineupId, game.gameId, value, onClose);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Size for ${game.gameName}`}>
            <div className="space-y-3">
                <SizeIntro />
                <SteamDbLink steamAppId={game.steamAppId} />
                <Field id="tie-size-gb" label="Install size (GB)" error={error ?? undefined}>
                    <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                </Field>
                <Button variant="primary" onClick={submit} loading={isPending}>
                    Save size
                </Button>
            </div>
        </Modal>
    );
}

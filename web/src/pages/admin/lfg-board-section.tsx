/**
 * ROK-1471: admin toggle for the LFG forum board.
 *
 * Server state only (TanStack Query) — no client store. A PUT can succeed while
 * the bot still lacks guild permissions; that arrives as `warning.missing` and is
 * surfaced inline with a link to the Connection page, where the invite URL lives.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { useLfgBoardSettings } from '../../hooks/admin/use-lfg-board-settings';

const BOT_CONNECTION_PATH = '/admin/settings/discord/connection';

const DESCRIPTION =
    'The bot creates and manages a forum channel where every forming group gets a post ' +
    'members can +1 to join.';

/** Missing-permission callout shown after a persisted-but-degraded write. */
function MissingPermissionWarning({ missing }: { missing: string[] }) {
    return (
        <div data-testid="lfg-board-warning" className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <p className="text-sm text-amber-400">
                Saved, but the bot is missing permissions the LFG board needs:
            </p>
            <ul className="text-xs text-amber-300 mt-2 space-y-0.5 list-disc list-inside">
                {missing.map((name) => (
                    <li key={name}>{name}</li>
                ))}
            </ul>
            <p className="text-xs text-amber-300 mt-2">
                Re-authorise the bot with the invite URL on the{' '}
                <Link to={BOT_CONNECTION_PATH} className="underline">Connection</Link> page.
            </p>
        </div>
    );
}

/** Toggle card for the LFG forum board. */
export function LfgBoardSection(): React.ReactElement {
    const { status, update } = useLfgBoardSettings();
    const [missing, setMissing] = useState<string[]>([]);
    const enabled = status.data?.enabled ?? false;

    const handleToggle = (checked: boolean): void => {
        update.mutate(
            { enabled: checked },
            {
                onSuccess: (result) => {
                    const names = result?.warning?.missing ?? [];
                    setMissing(names);
                    if (names.length === 0) {
                        toast.success(checked ? 'LFG board enabled' : 'LFG board disabled');
                    }
                },
                onError: () => toast.error('Failed to update LFG board setting'),
            },
        );
    };

    return (
        <div className="bg-surface rounded-xl border border-edge p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-foreground">LFG board</h3>
                    <p className="text-sm text-muted mt-1">{DESCRIPTION}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" aria-label="Enable LFG board" checked={enabled}
                        onChange={(e) => handleToggle(e.target.checked)} disabled={update.isPending}
                        className="sr-only peer" />
                    <div className="w-11 h-6 bg-dim rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
                </label>
            </div>
            {missing.length > 0 && <MissingPermissionWarning missing={missing} />}
        </div>
    );
}

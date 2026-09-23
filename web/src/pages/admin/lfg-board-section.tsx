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
import { LfgIndicatorEmojiField } from './lfg-indicator-emoji-field';
import { Switch } from '../../components/ui/switch';

const BOT_CONNECTION_PATH = '/admin/settings/discord/connection';

const DESCRIPTION =
    'The bot creates and manages a forum channel where every forming group gets a post ' +
    'members can +1 to join.';

const COMPOSER_DESCRIPTION =
    'Pins a "Looking for a group?" card with buttons in the LFG channel, so members can ' +
    'start a group without typing /lfg. On a forum board the buttons appear on the ' +
    'pinned "How this board works" post.';

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

/** Query + mutation wiring for the toggle, including the warning it can return. */
function useLfgBoardToggle() {
    const { status, update } = useLfgBoardSettings();
    const [missing, setMissing] = useState<string[]>([]);

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

    return {
        enabled: status.data?.enabled ?? false, emoji: status.data?.nowIndicatorEmoji,
        isPending: update.isPending, missing, handleToggle,
    };
}

/** ROK-1612 AC6 — the pinned composer card's opt-in, on the same card. */
function ComposerToggle() {
    const { status, updateComposer } = useLfgBoardSettings();
    const handleToggle = (checked: boolean): void => {
        updateComposer.mutate({ enabled: checked }, {
            onSuccess: () => toast.success(checked ? 'Composer card pinned' : 'Composer card removed'),
            onError: () => toast.error('Failed to update the LFG composer setting'),
        });
    };
    return (
        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-edge">
            <div>
                <h4 className="text-sm font-semibold text-foreground">Pinned composer card</h4>
                <p className="text-sm text-muted mt-1">{COMPOSER_DESCRIPTION}</p>
            </div>
            <Switch label="Pin the LFG composer card" checked={status.data?.composerEnabled ?? false}
                disabled={updateComposer.isPending} onChange={handleToggle} />
        </div>
    );
}

/** Toggle card for the LFG forum board. */
export function LfgBoardSection(): React.ReactElement {
    const { enabled, emoji, isPending, missing, handleToggle } = useLfgBoardToggle();

    return (
        <div className="bg-surface rounded-xl border border-edge p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-foreground">LFG board</h3>
                    <p className="text-sm text-muted mt-1">{DESCRIPTION}</p>
                </div>
                <Switch label="Enable LFG board" checked={enabled}
                    disabled={isPending} onChange={handleToggle} />
            </div>
            {missing.length > 0 && <MissingPermissionWarning missing={missing} />}
            <LfgIndicatorEmojiField key={emoji ?? ''} current={emoji} />
            <ComposerToggle />
        </div>
    );
}

/**
 * ROK-1619: the emoji that marks the press which forms an LFG group — on the
 * board card, the invite DM's Join button and the web group page.
 *
 * Stored raw; the server resolves it and falls back to 🎉 when it is blank or
 * the bot cannot use it (e.g. a custom emoji from another server).
 */
import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useLfgIndicatorEmoji } from '../../hooks/admin/use-lfg-board-settings';

const HINT =
    'Shown on the button that will start a group. Use an emoji like 🔥 or a server emoji ' +
    'name like :praise_sun:. Leave blank for 🎉, which is also used when the bot cannot use yours.';

/** Text field + Save for the indicator emoji. The parent keys it by `current`, so a new server value remounts it. */
export function LfgIndicatorEmojiField({ current }: { current: string | null | undefined }): React.ReactElement {
    const [value, setValue] = useState(current ?? '');
    const save = useLfgIndicatorEmoji();
    const onSave = (): void => {
        save.mutate({ emoji: value }, {
            onSuccess: () => toast.success('Indicator emoji saved'),
            onError: () => toast.error('Failed to save the indicator emoji'),
        });
    };
    return (
        <div className="mt-4 border-t border-edge pt-4">
            <label htmlFor="lfg-indicator-emoji" className="text-sm font-medium text-foreground">Group-start emoji</label>
            <p className="text-xs text-muted mt-1">{HINT}</p>
            <div className="mt-2 flex items-center gap-2">
                <input id="lfg-indicator-emoji" data-testid="lfg-indicator-emoji-input" value={value}
                    placeholder="🎉" maxLength={64} onChange={(e) => setValue(e.target.value)}
                    className="w-48 rounded-lg border border-edge bg-panel px-3 py-1.5 text-sm text-foreground" />
                <button type="button" aria-label="Save group-start emoji" onClick={onSave} disabled={save.isPending || value === (current ?? '')}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60">
                    Save
                </button>
            </div>
        </div>
    );
}

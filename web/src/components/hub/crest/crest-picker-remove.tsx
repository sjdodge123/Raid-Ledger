/**
 * ROK-1814 Q7 (operator ruling 2026-10-30) — staff moderation inside the crest
 * editor: "Remove upload" deletes the hub's stored upload. Admins/operators only
 * (`viewer.isStaff`), and only while the hub shows that upload. A destructive
 * action, so it asks first — inline, in the Upload section, rather than a second
 * dialog stacked over the editor's Modal/BottomSheet. After removal the editor
 * state refetches and the picker's "Removed by an admin" notice takes its place.
 */
import { useState, type JSX } from 'react';
import { Button } from '../../ui/button';
import { useRemoveGuildCrestUpload } from './use-guild-crest';

export function CrestRemoveUpload({ guildId }: { guildId: number }): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const remove = useRemoveGuildCrestUpload(guildId);
    if (!confirming) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-edge p-3" data-testid="crest-remove-upload">
                <p className="text-xs text-muted">Admin: remove this upload if it breaks the rules.</p>
                <Button variant="destructive-soft" size="sm" onClick={() => setConfirming(true)} data-testid="crest-remove-upload-button">Remove upload</Button>
            </div>
        );
    }
    return (
        <div role="group" aria-label="Confirm removal" className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3" data-testid="crest-remove-upload-confirm">
            <p className="text-sm text-foreground">Remove this upload for everyone? The hub falls back to its emblem or initials, and its editors see that an admin removed it.</p>
            {remove.error && <p role="alert" className="text-sm text-danger" data-testid="crest-remove-upload-error">Couldn&apos;t remove the upload. Try again.</p>}
            <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={remove.isPending}>Keep it</Button>
                <Button
                    variant="destructive" size="sm" loading={remove.isPending} loadingLabel="Removing…"
                    onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirming(false) })}
                    data-testid="crest-remove-upload-yes"
                >
                    Remove upload
                </Button>
            </div>
        </div>
    );
}

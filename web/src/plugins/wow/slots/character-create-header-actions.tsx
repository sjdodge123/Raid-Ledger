/**
 * WoW plugin filler for the core `character-create:header-actions` slot
 * (ROK-1738): "Import LedgerLink character" at the top of Add Character, then
 * an "or add manually" divider above the core form. Core renders the slot
 * only when creating (never editing) and shows nothing when no plugin fills
 * it, so the divider lives here. Visible with no game picked or the Forever
 * game picked (ruling Q5) — a LedgerLink export is always WoW: Forever.
 *
 * The create-mode `AddonImportDialog` is keyed per session (each opening
 * starts on an empty paste step) and stacks over Add Character. A confirmed
 * import closes both and lands on the character page (`useImportCreated`).
 */
import { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { isWowForeverSlug } from '../lib/forever-identity';
import { AddonImportDialog } from '../components/addon-import/addon-import-dialog';
import { useImportCreated } from '../components/addon-import/use-import-created';

export interface CharacterCreateHeaderActionsProps {
    /** Closes Add Character without its dirty guard (the import supersedes the form). */
    onClose: () => void;
    /** The picked game's slug; `''` before a game is picked. */
    gameSlug?: string | undefined;
}

function ManualDivider() {
    return (
        <div className="flex items-center gap-3" data-testid="add-manually-divider">
            <span className="flex-1 border-t border-edge" aria-hidden="true" />
            <span className="text-sm text-muted">or add manually</span>
            <span className="flex-1 border-t border-edge" aria-hidden="true" />
        </div>
    );
}

export function CharacterCreateHeaderActions({ onClose, gameSlug = '' }: CharacterCreateHeaderActionsProps) {
    const [open, setOpen] = useState(false);
    // A new key per opening: every session starts on an empty paste step.
    const [session, setSession] = useState(0);
    const onCreated = useImportCreated(() => { setOpen(false); onClose(); });
    if (gameSlug !== '' && !isWowForeverSlug(gameSlug)) return null;
    return (
        <div className="space-y-4">
            <Button type="button" variant="primary" fullWidth aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSession((n) => n + 1); setOpen(true); }}>
                <ArrowUpTrayIcon className="w-4 h-4" aria-hidden="true" />
                Import LedgerLink character
            </Button>
            <ManualDivider />
            <AddonImportDialog key={session} mode="create" isOpen={open} onClose={() => setOpen(false)} onCreated={onCreated} />
        </div>
    );
}

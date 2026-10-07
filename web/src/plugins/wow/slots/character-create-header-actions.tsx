/**
 * WoW plugin filler for the core `character-create:header-actions` slot
 * (ROK-1738): "Import LedgerLink character" at the top of Add Character, then
 * an "or add manually" divider above the core form. Core renders the slot
 * only when creating (never editing) and shows nothing when no plugin fills
 * it, so the divider lives here. Visible with no game picked or the Forever
 * game picked (ruling Q5) — a LedgerLink export is always WoW: Forever.
 *
 * The create-mode `AddonImportDialog` is mounted here by L4b (keyed per
 * session, `stacked` over the Add Character Modal; `useImportCreated(onClose)`
 * handles the confirm).
 */
import { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { isWowForeverSlug } from '../lib/forever-identity';

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

export function CharacterCreateHeaderActions({ gameSlug = '' }: CharacterCreateHeaderActionsProps) {
    const [open, setOpen] = useState(false);
    if (gameSlug !== '' && !isWowForeverSlug(gameSlug)) return null;
    return (
        <div className="space-y-4">
            <Button type="button" variant="primary" fullWidth aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
                <ArrowUpTrayIcon className="w-4 h-4" aria-hidden="true" />
                Import LedgerLink character
            </Button>
            <ManualDivider />
        </div>
    );
}

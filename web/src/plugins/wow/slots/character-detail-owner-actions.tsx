/**
 * WoW plugin filler for the core `character-detail:owner-actions` slot
 * (ROK-1724): the "Import string" button for a WoW: Forever character.
 * Core renders the slot for the owner only; this self-filters to Forever
 * (`useCharacterWowVariant`, incl. the game slug — ROK-1751), and the API
 * re-checks the game.
 */
import { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { useCharacterWowVariant } from '../hooks/use-character-wow-variant';
import { AddonImportDialog } from '../components/addon-import/addon-import-dialog';

interface CharacterDetailOwnerActionsProps {
    characterId: string;
    gameId?: number | undefined;
    ruleset?: string | null | undefined;
    gameVariant?: string | null | undefined;
}

export function CharacterDetailOwnerActions({ characterId, gameId, ruleset, gameVariant }: CharacterDetailOwnerActionsProps) {
    const [open, setOpen] = useState(false);
    // A new key per opening: every session starts on an empty paste step.
    const [session, setSession] = useState(0);
    const variant = useCharacterWowVariant({ gameVariant, ruleset, gameId });
    if (variant !== 'wow_forever') return null;
    return (
        <>
            <Button variant="secondary" size="sm" onClick={() => { setSession((n) => n + 1); setOpen(true); }}>
                <ArrowUpTrayIcon className="w-4 h-4" aria-hidden="true" />
                Import string
            </Button>
            <AddonImportDialog key={session} isOpen={open} onClose={() => setOpen(false)} characterId={characterId} gameId={gameId} />
        </>
    );
}

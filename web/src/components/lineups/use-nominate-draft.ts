/**
 * The NominateModal draft (ROK-935, ROK-1655): search query, selected game and
 * note, the paste pre-select sync (ROK-945), submit and the resetting close.
 *
 * `isDirty` feeds `useDirtyCloseGuard`: a selected game (a paste pre-select
 * counts) or a typed note is worth a "Discard your changes?" prompt; a search
 * query alone is not (ruling 15). A successful submit closes through
 * `handleClose` directly, never the guard, so it never asks.
 */
import { useCallback, useState } from 'react';
import { useNominateGame } from '../../hooks/use-lineups';

export interface SelectedGame {
    id: number;
    name: string;
    coverUrl: string | null;
}

interface NominateDraftOptions {
    isOpen: boolean;
    onClose: () => void;
    lineupId: number;
    preSelectedGame?: SelectedGame | null;
}

export interface NominateDraft {
    query: string;
    setQuery: (v: string) => void;
    selected: SelectedGame | null;
    setSelected: (g: SelectedGame | null) => void;
    note: string;
    setNote: (v: string) => void;
    /** "Back to search": drop the selection and its note. */
    handleBack: () => void;
    handleSubmit: () => void;
    /** Reset the draft and close — unguarded; the guard calls it on Discard. */
    handleClose: () => void;
    isPending: boolean;
    isDirty: boolean;
}

/** Apply a paste pre-selected game once per open (ROK-945); forget it on close. */
function usePreSelectSync(
    isOpen: boolean,
    preSelectedGame: SelectedGame | null | undefined,
    setSelected: (g: SelectedGame) => void,
): void {
    const [appliedPreSelect, setAppliedPreSelect] = useState<SelectedGame | null>(null);
    if (isOpen && preSelectedGame && preSelectedGame !== appliedPreSelect) {
        setAppliedPreSelect(preSelectedGame);
        setSelected(preSelectedGame);
    }
    if (!isOpen && appliedPreSelect) setAppliedPreSelect(null);
}

/** See file docstring. */
export function useNominateDraft({ isOpen, onClose, lineupId, preSelectedGame }: NominateDraftOptions): NominateDraft {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<SelectedGame | null>(null);
    const [note, setNote] = useState('');
    const nominate = useNominateGame();
    usePreSelectSync(isOpen, preSelectedGame, setSelected);

    const handleBack = useCallback(() => { setSelected(null); setNote(''); }, []);
    const handleClose = useCallback(() => {
        setSelected(null);
        setNote('');
        setQuery('');
        onClose();
    }, [onClose]);
    const handleSubmit = useCallback(() => {
        if (!selected) return;
        const body = note.trim() ? { gameId: selected.id, note: note.trim() } : { gameId: selected.id };
        nominate.mutate({ lineupId, body }, { onSuccess: handleClose });
    }, [selected, note, lineupId, nominate, handleClose]);

    const isDirty = selected !== null || note.trim() !== '';
    return {
        query, setQuery, selected, setSelected, note, setNote,
        handleBack, handleSubmit, handleClose, isPending: nominate.isPending, isDirty,
    };
}

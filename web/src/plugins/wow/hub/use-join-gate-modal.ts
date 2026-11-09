/**
 * ROK-2132 / ROK-2151 D5 — the Add character modal state shared by the
 * non-member join gate and the staff "Claim your character" banner: which tab
 * is open, and whether a character arrived since the viewer's list first loaded.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import { useMyCharacters } from '../../../hooks/use-characters';
import { gainedCharacter } from './wow-join-gate.helpers';

export type GateTab = 'roster' | 'import';

export interface GateModalState {
    tab: GateTab | null;
    ready: boolean;
    open: (tab: GateTab) => void;
    close: () => void;
    gained: boolean;
}

/**
 * The Add character modal's state, plus whether a character arrived since the
 * viewer's characters first loaded. The baseline is taken on that first load,
 * and the modal is not mounted (`ready`) until it exists (Codex P2): on the
 * `?claim=roster` landing (or a fast click) a claim made before the list
 * arrived would land in the baseline itself, and the AC 8 warning never shows.
 * `close()` invalidates the viewer's characters and the guild page (which
 * refetches the join-gate read keyed under it).
 */
export function useGateModal(guildId: number, gameId: number | undefined): GateModalState {
    const queryClient = useQueryClient();
    const chars = useMyCharacters(gameId, gameId !== undefined);
    const [tab, setTab] = useState<GateTab | null>(null);
    const [baseline, setBaseline] = useState<ReadonlySet<string> | null>(null);
    // The warning is about a gate action, so it waits for the modal to have opened.
    const [opened, setOpened] = useState(false);
    const current = chars.data?.data;
    // Adjust-state-during-render: record the first loaded list exactly once.
    if (baseline === null && current !== undefined) setBaseline(new Set(current.map((c) => c.id)));
    const open = useCallback((next: GateTab) => {
        setOpened(true);
        setTab(next);
    }, []);
    const close = useCallback(() => {
        setTab(null);
        void queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
        void queryClient.invalidateQueries({ queryKey: guildPageKey(guildId) });
    }, [queryClient, guildId]);
    // A failed list never yields a baseline; the modal still opens (no warning is possible then).
    const ready = baseline !== null || chars.isError;
    return { tab, ready, open, close, gained: opened && tab === null && gainedCharacter(baseline, current) };
}

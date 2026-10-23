/**
 * ROK-1918 L5 — arrange-mode state: the draft rows, the live-region text,
 * dirtiness against the layout arrange mode opened on, and the save/reset
 * mutation wired to toast + exit. The component (`hub-arrange-mode`) only lays it out.
 */
import { useCallback, useEffect, useState } from 'react';
import type { HubWidgetPrefs } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { httpStatusOf } from '../../../lib/api/api-error';
import type { ArrangedEntry, HubLayoutEntry } from '../layout/resolve-hub-layout';
import { addRow, buildPrefsBody, initDraft, moveAnnouncement, moveRow, moveTo, sameDraft, toggleRow, type DraftRow } from './arrange-draft';
import { useSaveWidgetPrefs } from './use-save-widget-prefs';

type Row = DraftRow<HubLayoutEntry>;

export interface ArrangeStateInput {
    guildId: number;
    arranged: readonly ArrangedEntry<HubLayoutEntry>[];
    prefs: HubWidgetPrefs | null;
    onExit: () => void;
}

/** Leaving the page (reload, close, external link) with an unsaved draft asks first. */
function useBeforeUnloadWhile(dirty: boolean): void {
    useEffect(() => {
        if (!dirty) return undefined;
        const onUnload = (e: BeforeUnloadEvent): void => { e.preventDefault(); };
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
    }, [dirty]);
}

function useDraftRows(arranged: ArrangeStateInput['arranged']) {
    const [initial] = useState<readonly Row[]>(() => initDraft(arranged));
    const [rows, setRows] = useState<readonly Row[]>(initial);
    const [live, setLive] = useState('');
    const move = useCallback((index: number, dir: -1 | 1) => {
        const next = moveRow(rows, index, dir);
        const moved = next[index + dir];
        if (next === rows || moved === undefined) return;
        setRows(next);
        setLive(moveAnnouncement(moved.entry.title, index + dir + 1, next.length));
    }, [rows]);
    const drop = useCallback((from: number, to: number) => {
        const next = moveTo(rows, from, to);
        const moved = next[to];
        if (next === rows || moved === undefined) return;
        setRows(next);
        setLive(moveAnnouncement(moved.entry.title, to + 1, next.length));
    }, [rows]);
    const toggle = useCallback((id: string) => setRows((cur) => toggleRow(cur, id)), []);
    const add = useCallback((entry: HubLayoutEntry) => {
        setRows((cur) => addRow(cur, entry));
        setLive(`${entry.title} added at position 1.`);
    }, []);
    return { rows, dirty: !sameDraft(rows, initial), live, move, drop, toggle, add };
}

function useSaveFlow({ guildId, prefs, onExit }: Omit<ArrangeStateInput, 'arranged'>) {
    const mutation = useSaveWidgetPrefs(guildId);
    const [error, setError] = useState<string | null>(null);
    const handlers = useCallback((done: string) => ({
        onSuccess: () => { toast.success(done); onExit(); },
        onError: (err: Error) => {
            if (httpStatusOf(err) === 403) { toast.error('You can no longer arrange this hub.'); onExit(); return; }
            setError("Couldn't save the layout. Try again.");
        },
    }), [onExit]);
    const save = (rows: readonly Row[]): void => { setError(null); mutation.mutate(buildPrefsBody(rows, prefs), handlers('Layout saved')); };
    const reset = (): void => { setError(null); mutation.mutate({ reset: true }, handlers('Default layout restored')); };
    return { save, reset, saving: mutation.isPending, error };
}

export function useArrangeState(input: ArrangeStateInput) {
    const draft = useDraftRows(input.arranged);
    const flow = useSaveFlow(input);
    useBeforeUnloadWhile(draft.dirty);
    return { ...draft, ...flow, save: () => flow.save(draft.rows) };
}

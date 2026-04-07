import { useState, useCallback } from 'react';
import { useGameTimeEditor } from '../../../hooks/use-game-time-editor';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences } from '../../../hooks/use-game-time';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimePreviewBlock } from './GameTimeGrid';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { EventBlockPopover } from './EventBlockPopover';
import { AbsenceForm, AbsenceList } from './game-time-absence';
import type { AbsenceState } from './game-time-absence';
import { toast } from '../../../lib/toast';

interface GameTimePanelProps {
    /** Controls header/buttons: 'profile' has save/clear, 'modal' has confirm-on-close, 'picker' is read-only */
    mode: 'profile' | 'modal' | 'picker';
    /** For modal mode: the event being previewed as a dashed block */
    previewBlocks?: GameTimePreviewBlock[];
    /** Hour range to display (default [0, 24]). Use [6, 24] in modals. */
    hourRange?: [number, number];
    /** Enable rolling/continual week (default true for non-profile modes) */
    rolling?: boolean;
    /** Called when user clicks an event block */
    onEventClick?: (event: GameTimeEventBlock) => void;
    /** Whether auth is confirmed (for useGameTime enabled) */
    enabled?: boolean;
}

function useAbsenceActions() {
    const createAbsence = useCreateAbsence();
    const deleteAbsence = useDeleteAbsence();

    const handleCreate = useCallback(async (state: AbsenceState, reset: () => void) => {
        if (!state.startDate || !state.endDate) return;
        try {
            await createAbsence.mutateAsync({
                startDate: state.startDate,
                endDate: state.endDate,
                reason: state.reason || undefined,
            });
            reset();
            toast.success('Absence created');
        } catch {
            toast.error('Failed to create absence');
        }
    }, [createAbsence]);

    const handleDelete = useCallback(async (id: number) => {
        try {
            await deleteAbsence.mutateAsync(id);
            toast.success('Absence removed');
        } catch {
            toast.error('Failed to remove absence');
        }
    }, [deleteAbsence]);

    return { createAbsence, deleteAbsence, handleCreate, handleDelete };
}

function ProfileHeader({ editor, showAbsenceForm, onToggleAbsence }: {
    editor: ReturnType<typeof useGameTimeEditor>;
    showAbsenceForm: boolean;
    onToggleAbsence: () => void;
}) {
    return (
        <div className="mb-3 space-y-2">
            <div>
                <h2 className="text-lg font-semibold text-foreground">My Game Time</h2>
                <p className="text-muted text-xs mt-0.5">Set your typical weekly availability</p>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={onToggleAbsence} className="px-4 py-2.5 text-sm font-medium rounded-lg transition-colors bg-red-600 text-foreground hover:bg-red-500">
                    {showAbsenceForm ? 'Cancel' : 'Absence'}
                </button>
                <button onClick={editor.clear} disabled={editor.slots.length === 0} className="px-4 py-2.5 text-sm font-medium rounded-lg transition-colors bg-panel text-muted hover:bg-overlay disabled:opacity-50 disabled:cursor-not-allowed">
                    Clear
                </button>
                {editor.isDirty && (
                    <button onClick={editor.discard} className="px-4 py-2.5 text-sm font-medium rounded-lg transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20">Discard</button>
                )}
                <button onClick={editor.save} disabled={!editor.isDirty || editor.isSaving} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground text-sm font-medium rounded-lg transition-colors">
                    {editor.isSaving && <div className="w-3 h-3 border-2 border-muted border-t-foreground rounded-full animate-spin" />}
                    Save
                </button>
            </div>
        </div>
    );
}

function ProfileAbsenceSection({ editor, absence, setAbsence, createAbsence, deleteAbsence, handleCreate, handleDelete }: {
    editor: ReturnType<typeof useGameTimeEditor>; absence: AbsenceState;
    setAbsence: React.Dispatch<React.SetStateAction<AbsenceState>>;
    createAbsence: ReturnType<typeof useCreateAbsence>; deleteAbsence: ReturnType<typeof useDeleteAbsence>;
    handleCreate: (state: AbsenceState, reset: () => void) => Promise<void>; handleDelete: (id: number) => Promise<void>;
}) {
    const { data: allAbsences } = useGameTimeAbsences();
    const sorted = [...(allAbsences ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const resetAbsence = () => setAbsence({ show: false, startDate: '', endDate: '', reason: '' });
    return (
        <>
            <ProfileHeader editor={editor} showAbsenceForm={absence.show} onToggleAbsence={() => setAbsence((s) => ({ ...s, show: !s.show }))} />
            {absence.show && <AbsenceForm state={absence} onChange={(p) => setAbsence((s) => ({ ...s, ...p }))} onSubmit={() => handleCreate(absence, resetAbsence)} isPending={createAbsence.isPending} />}
            {sorted.length > 0 && <AbsenceList absences={sorted} onDelete={handleDelete} isDeleting={deleteAbsence.isPending} />}
        </>
    );
}

export function GameTimePanel({
    mode, previewBlocks, hourRange, rolling = true, onEventClick, enabled = true,
}: GameTimePanelProps) {
    const effectiveRolling = mode === 'profile' ? false : rolling;
    const editor = useGameTimeEditor({ enabled, rolling: effectiveRolling });
    const [popoverEvent, setPopoverEvent] = useState<{ event: GameTimeEventBlock; anchorRect: DOMRect } | null>(null);
    const [absence, setAbsence] = useState<AbsenceState>({ show: false, startDate: '', endDate: '', reason: '' });
    const absenceActions = useAbsenceActions();
    const handleEventClick = useCallback((event: GameTimeEventBlock, anchorRect: DOMRect) => {
        if (onEventClick) onEventClick(event); else setPopoverEvent({ event, anchorRect });
    }, [onEventClick]);

    if (editor.isLoading) {
        return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" /></div>;
    }

    return (
        <GameTimePanelContent mode={mode} editor={editor} hourRange={hourRange}
            previewBlocks={previewBlocks} absence={absence} setAbsence={setAbsence} absenceActions={absenceActions}
            handleEventClick={handleEventClick} popoverEvent={popoverEvent} setPopoverEvent={setPopoverEvent} />
    );
}

function GameTimePanelContent({ mode, editor, hourRange, previewBlocks, absence, setAbsence, absenceActions, handleEventClick, popoverEvent, setPopoverEvent }: {
    mode: string; editor: ReturnType<typeof useGameTimeEditor>; hourRange?: [number, number];
    previewBlocks?: GameTimePreviewBlock[]; absence: AbsenceState; setAbsence: React.Dispatch<React.SetStateAction<AbsenceState>>;
    absenceActions: ReturnType<typeof useAbsenceActions>;
    handleEventClick: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
    popoverEvent: { event: GameTimeEventBlock; anchorRect: DOMRect } | null;
    setPopoverEvent: (v: { event: GameTimeEventBlock; anchorRect: DOMRect } | null) => void;
}) {
    const isReadOnly = mode === 'picker';
    return (
        <div>
            {mode === 'profile' && <ProfileAbsenceSection editor={editor} absence={absence} setAbsence={setAbsence} createAbsence={absenceActions.createAbsence} deleteAbsence={absenceActions.deleteAbsence} handleCreate={absenceActions.handleCreate} handleDelete={absenceActions.handleDelete} />}
            <GameTimeGrid slots={editor.slots} onChange={isReadOnly ? undefined : editor.handleChange} readOnly={isReadOnly}
                tzLabel={editor.tzLabel} hourRange={hourRange} fullDayNames={mode === 'profile'} noStickyOffset={mode === 'profile'} compact
                {...(mode !== 'profile' ? { events: editor.events, onEventClick: handleEventClick, previewBlocks, todayIndex: editor.todayIndex, currentHour: editor.currentHour, nextWeekEvents: editor.nextWeekEvents, nextWeekSlots: editor.nextWeekSlots, weekStart: editor.weekStart } : {})} />
            {mode !== 'profile' && popoverEvent && <EventBlockPopover event={popoverEvent.event} anchorRect={popoverEvent.anchorRect} onClose={() => setPopoverEvent(null)} />}
        </div>
    );
}

import { useState, useCallback } from 'react';
import { useGameTimeEditor } from '../../../hooks/use-game-time-editor';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useCreateAbsence, useDeleteAbsence } from '../../../hooks/use-game-time';
import { GameTimeGrid } from './GameTimeGrid';
import { GameTimeMobileEditor } from './GameTimeMobileEditor';
import type { GameTimePreviewBlock } from './GameTimeGrid';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { EventBlockPopover } from './EventBlockPopover';
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

const DATE_INPUT_CLS = 'px-2 py-1.5 text-sm bg-surface border border-edge-strong rounded-lg text-foreground focus:border-emerald-500 focus:outline-none';

interface AbsenceState {
    show: boolean;
    startDate: string;
    endDate: string;
    reason: string;
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

function AbsenceForm({ state, onChange, onSubmit, isPending }: {
    state: AbsenceState; onChange: (s: Partial<AbsenceState>) => void; onSubmit: () => void; isPending: boolean;
}) {
    return (
        <div className="mb-4 p-4 rounded-lg border border-edge bg-panel/50">
            <h3 className="text-sm font-medium text-foreground mb-3">New Absence</h3>
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="block text-xs text-muted mb-1">Start Date</label>
                    <input type="date" value={state.startDate} onChange={(e) => onChange({ startDate: e.target.value })} className={DATE_INPUT_CLS} />
                </div>
                <div>
                    <label className="block text-xs text-muted mb-1">End Date</label>
                    <input type="date" value={state.endDate} onChange={(e) => onChange({ endDate: e.target.value })} min={state.startDate} className={DATE_INPUT_CLS} />
                </div>
                <div className="flex-1 min-w-[120px]">
                    <label className="block text-xs text-muted mb-1">Reason (optional)</label>
                    <input type="text" value={state.reason} onChange={(e) => onChange({ reason: e.target.value })} placeholder="e.g. Vacation, Travel" maxLength={255} className={`w-full ${DATE_INPUT_CLS} placeholder-dim`} />
                </div>
                <button onClick={onSubmit} disabled={!state.startDate || !state.endDate || isPending} className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-overlay disabled:text-muted text-foreground text-sm font-medium rounded-lg transition-colors">
                    {isPending ? 'Saving...' : 'Add Absence'}
                </button>
            </div>
        </div>
    );
}

function AbsenceList({ absences, onDelete, isDeleting }: {
    absences: Array<{ id: number; startDate: string; endDate: string; reason?: string | null }>;
    onDelete: (id: number) => void; isDeleting: boolean;
}) {
    return (
        <div className="mb-4 flex flex-wrap gap-2">
            {absences.map((absence) => (
                <div key={absence.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-sm">
                    <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    <span className="text-red-300">
                        {absence.startDate} — {absence.endDate}
                        {absence.reason && <span className="text-red-400/70 ml-1">({absence.reason})</span>}
                    </span>
                    <button onClick={() => onDelete(absence.id)} disabled={isDeleting} className="text-red-400/60 hover:text-red-300 transition-colors ml-1" title="Remove absence">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            ))}
        </div>
    );
}

function ProfileAbsenceSection({ editor, absence, setAbsence, createAbsence, deleteAbsence, handleCreate, handleDelete }: {
    editor: ReturnType<typeof useGameTimeEditor>; absence: AbsenceState;
    setAbsence: React.Dispatch<React.SetStateAction<AbsenceState>>;
    createAbsence: ReturnType<typeof useCreateAbsence>; deleteAbsence: ReturnType<typeof useDeleteAbsence>;
    handleCreate: (state: AbsenceState, reset: () => void) => Promise<void>; handleDelete: (id: number) => Promise<void>;
}) {
    const resetAbsence = () => setAbsence({ show: false, startDate: '', endDate: '', reason: '' });
    return (
        <>
            <ProfileHeader editor={editor} showAbsenceForm={absence.show} onToggleAbsence={() => setAbsence((s) => ({ ...s, show: !s.show }))} />
            {absence.show && <AbsenceForm state={absence} onChange={(p) => setAbsence((s) => ({ ...s, ...p }))} onSubmit={() => handleCreate(absence, resetAbsence)} isPending={createAbsence.isPending} />}
            {editor.absences.length > 0 && <AbsenceList absences={editor.absences} onDelete={handleDelete} isDeleting={deleteAbsence.isPending} />}
        </>
    );
}

export function GameTimePanel({
    mode, previewBlocks, hourRange, rolling = true, onEventClick, enabled = true,
}: GameTimePanelProps) {
    const effectiveRolling = mode === 'profile' ? false : rolling;
    const editor = useGameTimeEditor({ enabled, rolling: effectiveRolling });
    const isMobile = useMediaQuery('(max-width: 767px)');
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
        <GameTimePanelContent mode={mode} editor={editor} isMobile={isMobile} hourRange={hourRange}
            previewBlocks={previewBlocks} absence={absence} setAbsence={setAbsence} absenceActions={absenceActions}
            handleEventClick={handleEventClick} popoverEvent={popoverEvent} setPopoverEvent={setPopoverEvent} />
    );
}

function GameTimePanelContent({ mode, editor, isMobile, hourRange, previewBlocks, absence, setAbsence, absenceActions, handleEventClick, popoverEvent, setPopoverEvent }: {
    mode: string; editor: ReturnType<typeof useGameTimeEditor>; isMobile: boolean; hourRange?: [number, number];
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
            {isMobile ? (
                <GameTimeMobileEditor slots={editor.slots} onChange={editor.handleChange} readOnly={isReadOnly} tzLabel={editor.tzLabel} />
            ) : (
                <GameTimeGrid slots={editor.slots} onChange={isReadOnly ? undefined : editor.handleChange} readOnly={isReadOnly}
                    tzLabel={editor.tzLabel} hourRange={hourRange} fullDayNames={mode === 'profile'} noStickyOffset={mode === 'profile'}
                    {...(mode !== 'profile' ? { events: editor.events, onEventClick: handleEventClick, previewBlocks, todayIndex: editor.todayIndex, currentHour: editor.currentHour, nextWeekEvents: editor.nextWeekEvents, nextWeekSlots: editor.nextWeekSlots, weekStart: editor.weekStart } : {})} />
            )}
            {mode !== 'profile' && popoverEvent && <EventBlockPopover event={popoverEvent.event} anchorRect={popoverEvent.anchorRect} onClose={() => setPopoverEvent(null)} />}
        </div>
    );
}

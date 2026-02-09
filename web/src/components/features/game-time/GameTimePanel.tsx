import { useState, useCallback } from 'react';
import { useGameTimeEditor } from '../../../hooks/use-game-time-editor';
import { useCreateAbsence, useDeleteAbsence } from '../../../hooks/use-game-time';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimePreviewBlock } from './GameTimeGrid';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { EventBlockPopover } from './EventBlockPopover';
import { toast } from 'sonner';

interface GameTimePanelProps {
    /** Controls header/buttons: 'profile' has save/clear, 'modal' has confirm-on-close, 'picker' is read-only */
    mode: 'profile' | 'modal' | 'picker';
    /** For modal mode: the event being previewed as a dashed block */
    previewBlocks?: GameTimePreviewBlock[];
    /** Hour range to display (default [0, 24]). Use [6, 24] in modals. */
    hourRange?: [number, number];
    /** Enable rolling/continual week (default true) */
    rolling?: boolean;
    /** Called when user clicks an event block */
    onEventClick?: (event: GameTimeEventBlock) => void;
    /** Whether auth is confirmed (for useGameTime enabled) */
    enabled?: boolean;
}

export function GameTimePanel({
    mode,
    previewBlocks,
    hourRange,
    rolling = true,
    onEventClick,
    enabled = true,
}: GameTimePanelProps) {
    const editor = useGameTimeEditor({ enabled, rolling });
    const [popoverEvent, setPopoverEvent] = useState<{ event: GameTimeEventBlock; anchorRect: DOMRect } | null>(null);
    const [showAbsenceForm, setShowAbsenceForm] = useState(false);
    const [absenceStartDate, setAbsenceStartDate] = useState('');
    const [absenceEndDate, setAbsenceEndDate] = useState('');
    const [absenceReason, setAbsenceReason] = useState('');

    const createAbsence = useCreateAbsence();
    const deleteAbsence = useDeleteAbsence();

    const handleEventClick = useCallback((event: GameTimeEventBlock, anchorRect: DOMRect) => {
        if (onEventClick) {
            onEventClick(event);
        } else {
            setPopoverEvent({ event, anchorRect });
        }
    }, [onEventClick]);

    const handleCreateAbsence = useCallback(async () => {
        if (!absenceStartDate || !absenceEndDate) return;
        try {
            await createAbsence.mutateAsync({
                startDate: absenceStartDate,
                endDate: absenceEndDate,
                reason: absenceReason || undefined,
            });
            setShowAbsenceForm(false);
            setAbsenceStartDate('');
            setAbsenceEndDate('');
            setAbsenceReason('');
            toast.success('Absence created');
        } catch {
            toast.error('Failed to create absence');
        }
    }, [absenceStartDate, absenceEndDate, absenceReason, createAbsence]);

    const handleDeleteAbsence = useCallback(async (id: number) => {
        try {
            await deleteAbsence.mutateAsync(id);
            toast.success('Absence removed');
        } catch {
            toast.error('Failed to remove absence');
        }
    }, [deleteAbsence]);

    if (editor.isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-slate-500 border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    const isReadOnly = mode === 'picker';

    return (
        <div>
            {/* Header with action buttons (profile mode only) */}
            {mode === 'profile' && (
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-semibold text-white">My Game Time this week</h2>
                        <p className="text-slate-400 text-sm mt-1">
                            Your weekly template + this week's events
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowAbsenceForm(!showAbsenceForm)}
                            className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-lg transition-colors"
                        >
                            {showAbsenceForm ? 'Cancel' : 'Set Absence'}
                        </button>
                        <button
                            onClick={editor.clear}
                            disabled={editor.slots.length === 0}
                            className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Clear All
                        </button>
                        <button
                            onClick={editor.save}
                            disabled={!editor.isDirty || editor.isSaving}
                            className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            {editor.isSaving && (
                                <div className="w-3 h-3 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
                            )}
                            Save Game Time
                        </button>
                    </div>
                </div>
            )}

            {/* Absence form (profile mode) */}
            {mode === 'profile' && showAbsenceForm && (
                <div className="mb-4 p-4 rounded-lg border border-slate-700 bg-slate-800/50">
                    <h3 className="text-sm font-medium text-white mb-3">New Absence</h3>
                    <div className="flex flex-wrap items-end gap-3">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                            <input
                                type="date"
                                value={absenceStartDate}
                                onChange={(e) => setAbsenceStartDate(e.target.value)}
                                className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">End Date</label>
                            <input
                                type="date"
                                value={absenceEndDate}
                                onChange={(e) => setAbsenceEndDate(e.target.value)}
                                min={absenceStartDate}
                                className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        <div className="flex-1 min-w-[120px]">
                            <label className="block text-xs text-slate-400 mb-1">Reason (optional)</label>
                            <input
                                type="text"
                                value={absenceReason}
                                onChange={(e) => setAbsenceReason(e.target.value)}
                                placeholder="e.g. Vacation, Travel"
                                maxLength={255}
                                className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={handleCreateAbsence}
                            disabled={!absenceStartDate || !absenceEndDate || createAbsence.isPending}
                            className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-400 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            {createAbsence.isPending ? 'Saving...' : 'Add Absence'}
                        </button>
                    </div>
                </div>
            )}

            {/* Active absences list (profile mode) */}
            {mode === 'profile' && editor.absences.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                    {editor.absences.map((absence) => (
                        <div
                            key={absence.id}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-sm"
                        >
                            <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            <span className="text-red-300">
                                {absence.startDate} — {absence.endDate}
                                {absence.reason && <span className="text-red-400/70 ml-1">({absence.reason})</span>}
                            </span>
                            <button
                                onClick={() => handleDeleteAbsence(absence.id)}
                                disabled={deleteAbsence.isPending}
                                className="text-red-400/60 hover:text-red-300 transition-colors ml-1"
                                title="Remove absence"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <GameTimeGrid
                slots={editor.slots}
                onChange={isReadOnly ? undefined : editor.handleChange}
                readOnly={isReadOnly}
                tzLabel={editor.tzLabel}
                events={editor.events}
                onEventClick={handleEventClick}
                previewBlocks={previewBlocks}
                todayIndex={editor.todayIndex}
                currentHour={editor.currentHour}
                hourRange={hourRange}
                nextWeekEvents={editor.nextWeekEvents}
                nextWeekSlots={editor.nextWeekSlots}
                weekStart={editor.weekStart}
            />

            {/* Event block popover */}
            {popoverEvent && (
                <EventBlockPopover
                    event={popoverEvent.event}
                    anchorRect={popoverEvent.anchorRect}
                    onClose={() => setPopoverEvent(null)}
                />
            )}
        </div>
    );
}

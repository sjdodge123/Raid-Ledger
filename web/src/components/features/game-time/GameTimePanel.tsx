import { useState, useCallback, useMemo } from 'react';
import type { JSX } from 'react';
import { useGameTimeEditor } from '../../../hooks/use-game-time-editor';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimePreviewBlock } from './GameTimeGrid';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { EventBlockPopover } from './EventBlockPopover';
import { PHONE_MQ } from '../../../lib/breakpoints';
import { PhoneWindowToggle } from './phone/PhoneWindowToggle';
import { useDesktopProfileWindow } from './use-desktop-profile-window';
import { awayDatesInWeek } from './phone/away-days';

interface GameTimePanelProps {
    /** Controls header/buttons: 'profile' has save/clear, 'modal' has confirm-on-close, 'picker' is read-only */
    mode: 'profile' | 'modal' | 'picker';
    /** For modal mode: the event being previewed as a dashed block */
    previewBlocks?: GameTimePreviewBlock[];
    /** Hour range to display (default [0, 24]). Use [6, 24] in modals. Profile mode owns its own window. */
    hourRange?: [number, number];
    /** Enable rolling/continual week (default true for non-profile modes) */
    rolling?: boolean;
    /** Called when user clicks an event block */
    onEventClick?: (event: GameTimeEventBlock) => void;
    /** Whether auth is confirmed (for useGameTime enabled) */
    enabled?: boolean;
}

type Editor = ReturnType<typeof useGameTimeEditor>;
type PopoverState = { event: GameTimeEventBlock; anchorRect: DOMRect } | null;

function ProfileHeader(): JSX.Element {
    return (
        <div className="mb-3">
            <h2 className="text-lg font-semibold text-foreground">My Game Time</h2>
            <p className="text-muted text-xs mt-0.5">Set your typical weekly availability</p>
        </div>
    );
}

/** Clear / Discard / Save — under the grid, right-aligned (ROK-1585 Q9, D1 artboard). */
function ProfileActions({ editor }: { editor: Editor }): JSX.Element {
    return (
        <div data-testid="game-time-profile-actions" className="mt-3 flex items-center justify-end gap-2">
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
    );
}

/** The Sunday that starts the week containing today, local midnight. */
function currentWeekStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
}

/**
 * The profile's week (ROK-1585 AC4a): "Show earlier" above the grid, "Show
 * later" below it, the actions under both, and this week's away days marked.
 */
function ProfileWeek({ editor, isMobile }: { editor: Editor; isMobile: boolean }): JSX.Element {
    const win = useDesktopProfileWindow(editor.slots);
    const awayDays = useMemo(() => awayDatesInWeek(editor.absences, currentWeekStart()), [editor.absences]);
    return (
        <div>
            <ProfileHeader />
            <div className="mb-2"><PhoneWindowToggle direction="earlier" band={win.earlier} testIdPrefix="desktop-week" /></div>
            <GameTimeGrid slots={editor.slots} onChange={editor.handleChange} tzLabel={editor.tzLabel}
                hourRange={win.hourRange} fullDayNames={!isMobile} noStickyOffset compact awayDays={awayDays} />
            <div className="mt-2"><PhoneWindowToggle direction="later" band={win.later} testIdPrefix="desktop-week" /></div>
            <ProfileActions editor={editor} />
        </div>
    );
}

export function GameTimePanel({
    mode, previewBlocks, hourRange, rolling = true, onEventClick, enabled = true,
}: GameTimePanelProps): JSX.Element {
    const editor = useGameTimeEditor({ enabled, rolling: mode === 'profile' ? false : rolling });
    const isMobile = useMediaQuery(PHONE_MQ);
    const [popoverEvent, setPopoverEvent] = useState<PopoverState>(null);
    const handleEventClick = useCallback((event: GameTimeEventBlock, anchorRect: DOMRect) => {
        if (onEventClick) onEventClick(event); else setPopoverEvent({ event, anchorRect });
    }, [onEventClick]);

    if (editor.isLoading) {
        return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" /></div>;
    }
    if (mode === 'profile') return <ProfileWeek editor={editor} isMobile={isMobile} />;

    const isReadOnly = mode === 'picker';
    return (
        <div>
            <GameTimeGrid slots={editor.slots} onChange={isReadOnly ? undefined : editor.handleChange} readOnly={isReadOnly}
                tzLabel={editor.tzLabel} hourRange={hourRange} compact events={editor.events} onEventClick={handleEventClick}
                previewBlocks={previewBlocks} todayIndex={editor.todayIndex} currentHour={editor.currentHour}
                nextWeekEvents={editor.nextWeekEvents} nextWeekSlots={editor.nextWeekSlots} weekStart={editor.weekStart} />
            {popoverEvent && <EventBlockPopover event={popoverEvent.event} anchorRect={popoverEvent.anchorRect} onClose={() => setPopoverEvent(null)} />}
        </div>
    );
}

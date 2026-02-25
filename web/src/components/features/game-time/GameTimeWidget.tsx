import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useGameTimeEditor } from '../../../hooks/use-game-time-editor';
import { Modal } from '../../ui/modal';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimePreviewBlock } from './GameTimeGrid';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { EventBlockPopover } from './EventBlockPopover';
import { AttendeeAvatars } from '../../calendar/AttendeeAvatars';

interface AttendeePreview {
    id: number;
    username: string;
    avatar: string | null;
}

interface GameTimeWidgetProps {
    eventStartTime: string;
    eventEndTime: string;
    eventTitle?: string;
    gameName?: string;
    gameSlug?: string;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string | null;
    attendees?: AttendeePreview[];
    attendeeCount?: number;
}

/**
 * Compute a smart hour range that always includes the event with padding.
 * Returns [start, end] where the range is at least 12 hours.
 */
function computeSmartHourRange(eventStartTime: string, eventEndTime: string): [number, number] {
    const start = new Date(eventStartTime);
    const end = new Date(eventEndTime);
    const startHour = start.getHours();
    const endHour = end.getHours() + (end.getMinutes() > 0 ? 1 : 0);

    // Pad 2 hours before and after the event
    const rangeStart = Math.max(0, startHour - 2);
    const rangeEnd = Math.min(24, endHour + 2);

    // Ensure at least 12 hours of visible range
    const span = rangeEnd - rangeStart;
    if (span < 12) {
        const deficit = 12 - span;
        const addBefore = Math.min(rangeStart, Math.ceil(deficit / 2));
        const addAfter = Math.min(24 - rangeEnd, deficit - addBefore);
        return [rangeStart - addBefore, rangeEnd + addAfter];
    }

    return [rangeStart, rangeEnd];
}

/**
 * Compact card for event detail page showing whether the user's game time
 * overlaps with the event. Clickable to open a read-only game time modal.
 */
export function GameTimeWidget({
    eventStartTime,
    eventEndTime,
    eventTitle,
    gameName,
    gameSlug,
    coverUrl,
    description,
    creatorUsername,
    attendees,
    attendeeCount,
}: GameTimeWidgetProps) {
    const editor = useGameTimeEditor({ enabled: true, rolling: true });
    const [showModal, setShowModal] = useState(false);
    const [popoverEvent, setPopoverEvent] = useState<{ event: GameTimeEventBlock; anchorRect: DOMRect } | null>(null);

    // Compute overlap: walk event hours, check each against template slots
    const hasOverlap = useMemo(() => {
        if (!editor.slots.length) return false;

        const templateSet = new Set(
            editor.slots
                .filter((s) => s.status === 'available' || !s.status)
                .map((s) => `${s.dayOfWeek}:${s.hour}`),
        );

        const start = new Date(eventStartTime);
        const end = new Date(eventEndTime);
        const cursor = new Date(start);
        cursor.setMinutes(0, 0, 0);
        if (cursor < start) cursor.setHours(cursor.getHours() + 1);

        while (cursor < end) {
            // Convert JS getDay (0=Sunday) to game-time dayOfWeek (0=Monday)
            const jsDay = cursor.getDay();
            const gameDay = jsDay === 0 ? 6 : jsDay - 1;
            const hour = cursor.getHours();
            if (templateSet.has(`${gameDay}:${hour}`)) return true;
            cursor.setHours(cursor.getHours() + 1);
        }
        return false;
    }, [editor.slots, eventStartTime, eventEndTime]);

    // Build preview blocks with rich event data inside the dashed block
    const previewBlocks = useMemo<GameTimePreviewBlock[]>(() => {
        const start = new Date(eventStartTime);
        const end = new Date(eventEndTime);
        const cursor = new Date(start);
        cursor.setMinutes(0, 0, 0);
        if (cursor < start) cursor.setHours(cursor.getHours() + 1);

        const dayHours = new Map<number, number[]>();
        while (cursor < end) {
            const gridDay = cursor.getDay();
            const hour = cursor.getHours();
            const hours = dayHours.get(gridDay) ?? [];
            hours.push(hour);
            dayHours.set(gridDay, hours);
            cursor.setHours(cursor.getHours() + 1);
        }

        const blocks: GameTimePreviewBlock[] = [];
        for (const [dayOfWeek, hours] of dayHours) {
            hours.sort((a, b) => a - b);
            let blockStart = hours[0];
            let prev = hours[0];
            for (let i = 1; i <= hours.length; i++) {
                if (i === hours.length || hours[i] !== prev + 1) {
                    blocks.push({
                        dayOfWeek,
                        startHour: blockStart,
                        endHour: prev + 1,
                        label: eventTitle ?? 'This Event',
                        title: eventTitle,
                        gameName,
                        gameSlug,
                        coverUrl,
                        description,
                        creatorUsername,
                        attendees,
                        attendeeCount,
                    });
                    if (i < hours.length) blockStart = hours[i];
                }
                if (i < hours.length) prev = hours[i];
            }
        }
        return blocks;
    }, [eventStartTime, eventEndTime, eventTitle, gameName, gameSlug, coverUrl, description, creatorUsername, attendees, attendeeCount]);

    // Smart hour range that always shows the full event
    const modalHourRange = useMemo<[number, number]>(
        () => computeSmartHourRange(eventStartTime, eventEndTime),
        [eventStartTime, eventEndTime],
    );

    // Formatted time label for the event detail card
    const eventTimeLabel = useMemo(() => {
        const start = new Date(eventStartTime);
        const end = new Date(eventEndTime);
        const fmt = (d: Date) => {
            const h = d.getHours();
            const m = d.getMinutes();
            const h12 = h % 12 || 12;
            const ampm = h < 12 ? 'AM' : 'PM';
            return m > 0 ? `${h12}:${m.toString().padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
        };
        return `${fmt(start)} – ${fmt(end)}`;
    }, [eventStartTime, eventEndTime]);

    const handleEventClick = useCallback((event: GameTimeEventBlock, anchorRect: DOMRect) => {
        setPopoverEvent({ event, anchorRect });
    }, []);

    if (editor.isLoading) return null;

    return (
        <>
            <div
                className="flex items-center gap-2 h-full min-h-[2.75rem] px-3 rounded-lg cursor-pointer transition-colors"
                style={{
                    background: 'var(--gt-widget-bg)',
                    backdropFilter: 'blur(8px)',
                    border: hasOverlap ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid var(--gt-widget-border)',
                }}
                onClick={() => setShowModal(true)}
                data-testid="game-time-widget"
            >
                {hasOverlap ? (
                    <>
                        <svg className="w-4 h-4 text-emerald-400 shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgba(52, 211, 153, 0.6))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Inside Game Time</span>
                    </>
                ) : (
                    <>
                        <svg className="w-4 h-4 text-amber-400 shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgba(251, 191, 36, 0.5))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Outside Game Time</span>
                    </>
                )}
                <svg className="w-3 h-3 text-dim ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
            </div>

            {showModal && (
                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    title="My Game Time"
                    maxWidth="max-w-3xl"
                >
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-muted text-xs">
                            Read-only view — your weekly availability with this event highlighted
                        </p>
                        <Link
                            to="/profile/gaming"
                            onClick={() => setShowModal(false)}
                            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                        >
                            Edit my game time &rarr;
                        </Link>
                    </div>
                    <GameTimeGrid
                        slots={editor.slots}
                        readOnly
                        tzLabel={editor.tzLabel}
                        events={editor.events}
                        previewBlocks={previewBlocks}
                        onEventClick={handleEventClick}
                        todayIndex={editor.todayIndex}
                        currentHour={editor.currentHour}
                        hourRange={modalHourRange}
                        nextWeekEvents={editor.nextWeekEvents}
                        nextWeekSlots={editor.nextWeekSlots}
                        weekStart={editor.weekStart}
                    />

                    {/* Event detail card — inline summary of the previewed event */}
                    {eventTitle && (
                        <div className="mt-3 p-3 rounded-lg border border-amber-500/20 bg-panel/60 flex items-start gap-3">
                            {coverUrl && (
                                <div
                                    className="w-10 h-10 rounded-md bg-cover bg-center shrink-0"
                                    style={{ backgroundImage: `url(${coverUrl})` }}
                                />
                            )}
                            <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-semibold text-foreground truncate">{eventTitle}</h4>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                                    {gameName && <span>{gameName}</span>}
                                    {gameName && eventTimeLabel && <span className="text-faint">·</span>}
                                    {eventTimeLabel && <span>{eventTimeLabel}</span>}
                                </div>
                                {creatorUsername && (
                                    <p className="text-[11px] text-dim mt-0.5">by {creatorUsername}</p>
                                )}
                            </div>
                            {attendees && attendees.length > 0 && (
                                <div className="shrink-0">
                                    <AttendeeAvatars
                                        signups={attendees}
                                        totalCount={attendeeCount ?? attendees.length}
                                        maxVisible={4}
                                        size="xs"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </Modal>
            )}

            {popoverEvent && (
                <EventBlockPopover
                    event={popoverEvent.event}
                    anchorRect={popoverEvent.anchorRect}
                    onClose={() => setPopoverEvent(null)}
                />
            )}
        </>
    );
}

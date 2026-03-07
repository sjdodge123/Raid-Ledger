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

function computeSmartHourRange(startTime: string, endTime: string): [number, number] {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startHour = start.getHours();
    const endHour = end.getHours() + (end.getMinutes() > 0 ? 1 : 0);
    const rangeStart = Math.max(0, startHour - 2);
    const rangeEnd = Math.min(24, endHour + 2);
    const span = rangeEnd - rangeStart;
    if (span < 12) {
        const deficit = 12 - span;
        const addBefore = Math.min(rangeStart, Math.ceil(deficit / 2));
        const addAfter = Math.min(24 - rangeEnd, deficit - addBefore);
        return [rangeStart - addBefore, rangeEnd + addAfter];
    }
    return [rangeStart, rangeEnd];
}

function checkGameTimeOverlap(slots: Array<{ dayOfWeek: number; hour: number; status?: string }>, startTime: string, endTime: string): boolean {
    if (!slots.length) return false;
    const templateSet = new Set(
        slots.filter((s) => s.status === 'available' || !s.status).map((s) => `${s.dayOfWeek}:${s.hour}`),
    );
    const start = new Date(startTime);
    const end = new Date(endTime);
    const cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    if (cursor < start) cursor.setHours(cursor.getHours() + 1);
    while (cursor < end) {
        const jsDay = cursor.getDay();
        const gameDay = jsDay === 0 ? 6 : jsDay - 1;
        if (templateSet.has(`${gameDay}:${cursor.getHours()}`)) return true;
        cursor.setHours(cursor.getHours() + 1);
    }
    return false;
}

function collectDayHours(startTime: string, endTime: string): Map<number, number[]> {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const cursor = new Date(start);
    cursor.setMinutes(0, 0, 0);
    if (cursor < start) cursor.setHours(cursor.getHours() + 1);
    const dayHours = new Map<number, number[]>();
    while (cursor < end) {
        const hours = dayHours.get(cursor.getDay()) ?? [];
        hours.push(cursor.getHours());
        dayHours.set(cursor.getDay(), hours);
        cursor.setHours(cursor.getHours() + 1);
    }
    return dayHours;
}

function buildPreviewBlocks(
    dayHours: Map<number, number[]>,
    meta: Omit<GameTimePreviewBlock, 'dayOfWeek' | 'startHour' | 'endHour'>,
): GameTimePreviewBlock[] {
    const blocks: GameTimePreviewBlock[] = [];
    for (const [dayOfWeek, hours] of dayHours) {
        hours.sort((a, b) => a - b);
        let blockStart = hours[0];
        let prev = hours[0];
        for (let i = 1; i <= hours.length; i++) {
            if (i === hours.length || hours[i] !== prev + 1) {
                blocks.push({ dayOfWeek, startHour: blockStart, endHour: prev + 1, ...meta });
                if (i < hours.length) blockStart = hours[i];
            }
            if (i < hours.length) prev = hours[i];
        }
    }
    return blocks;
}

function formatTimeLabel(startTime: string, endTime: string): string {
    const fmt = (d: Date) => {
        const h = d.getHours();
        const m = d.getMinutes();
        const h12 = h % 12 || 12;
        const ampm = h < 12 ? 'AM' : 'PM';
        return m > 0 ? `${h12}:${m.toString().padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
    };
    return `${fmt(new Date(startTime))} – ${fmt(new Date(endTime))}`;
}

function OverlapBadge({ hasOverlap }: { hasOverlap: boolean }) {
    if (hasOverlap) {
        return (
            <>
                <svg className="w-4 h-4 text-emerald-400 shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgba(52, 211, 153, 0.6))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Inside Game Time</span>
            </>
        );
    }
    return (
        <>
            <svg className="w-4 h-4 text-amber-400 shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgba(251, 191, 36, 0.5))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Outside Game Time</span>
        </>
    );
}

function EventDetailCard({ title, coverUrl, gameName, timeLabel, creatorUsername, attendees, attendeeCount }: {
    title: string; coverUrl?: string | null; gameName?: string; timeLabel: string; creatorUsername?: string | null;
    attendees?: AttendeePreview[]; attendeeCount?: number;
}) {
    return (
        <div className="mt-3 p-3 rounded-lg border border-amber-500/20 bg-panel/60 flex items-start gap-3">
            {coverUrl && <div className="w-10 h-10 rounded-md bg-cover bg-center shrink-0" style={{ backgroundImage: `url(${coverUrl})` }} />}
            <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                    {gameName && <span>{gameName}</span>}
                    {gameName && timeLabel && <span className="text-faint">·</span>}
                    {timeLabel && <span>{timeLabel}</span>}
                </div>
                {creatorUsername && <p className="text-[11px] text-dim mt-0.5">by {creatorUsername}</p>}
            </div>
            {attendees && attendees.length > 0 && (
                <div className="shrink-0">
                    <AttendeeAvatars signups={attendees} totalCount={attendeeCount ?? attendees.length} maxVisible={4} size="xs" />
                </div>
            )}
        </div>
    );
}

function useGameTimeWidgetData(props: GameTimeWidgetProps) {
    const { eventStartTime, eventEndTime, eventTitle, gameName, gameSlug, coverUrl, description, creatorUsername, attendees, attendeeCount } = props;
    const editor = useGameTimeEditor({ enabled: true, rolling: true });
    const hasOverlap = useMemo(() => checkGameTimeOverlap(editor.slots, eventStartTime, eventEndTime), [editor.slots, eventStartTime, eventEndTime]);
    const previewBlocks = useMemo<GameTimePreviewBlock[]>(() => {
        const dayHours = collectDayHours(eventStartTime, eventEndTime);
        const meta = { label: eventTitle ?? 'This Event', title: eventTitle, gameName, gameSlug, coverUrl, description, creatorUsername, attendees, attendeeCount };
        return buildPreviewBlocks(dayHours, meta);
    }, [eventStartTime, eventEndTime, eventTitle, gameName, gameSlug, coverUrl, description, creatorUsername, attendees, attendeeCount]);
    const modalHourRange = useMemo<[number, number]>(() => computeSmartHourRange(eventStartTime, eventEndTime), [eventStartTime, eventEndTime]);
    const eventTimeLabel = useMemo(() => formatTimeLabel(eventStartTime, eventEndTime), [eventStartTime, eventEndTime]);
    return { editor, hasOverlap, previewBlocks, modalHourRange, eventTimeLabel };
}

function GameTimeWidgetModal({ editor, previewBlocks, modalHourRange, eventTitle, coverUrl, gameName, eventTimeLabel, creatorUsername, attendees, attendeeCount, onClose, onEventClick }: {
    editor: ReturnType<typeof useGameTimeEditor>; previewBlocks: GameTimePreviewBlock[]; modalHourRange: [number, number];
    eventTitle?: string; coverUrl?: string | null; gameName?: string; eventTimeLabel: string; creatorUsername?: string | null;
    attendees?: { id: number; username: string; avatar: string | null }[]; attendeeCount?: number;
    onClose: () => void; onEventClick: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
}) {
    return (
        <Modal isOpen onClose={onClose} title="My Game Time" maxWidth="max-w-3xl">
            <div className="flex items-center justify-between mb-3">
                <p className="text-muted text-xs">Read-only view — your weekly availability with this event highlighted</p>
                <Link to="/profile/gaming" onClick={onClose} className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium">Edit my game time &rarr;</Link>
            </div>
            <GameTimeGrid slots={editor.slots} readOnly tzLabel={editor.tzLabel} events={editor.events}
                previewBlocks={previewBlocks} onEventClick={onEventClick} todayIndex={editor.todayIndex}
                currentHour={editor.currentHour} hourRange={modalHourRange} nextWeekEvents={editor.nextWeekEvents}
                nextWeekSlots={editor.nextWeekSlots} weekStart={editor.weekStart} />
            {eventTitle && <EventDetailCard title={eventTitle} coverUrl={coverUrl} gameName={gameName} timeLabel={eventTimeLabel} creatorUsername={creatorUsername} attendees={attendees} attendeeCount={attendeeCount} />}
        </Modal>
    );
}

export function GameTimeWidget(props: GameTimeWidgetProps) {
    const { eventTitle, gameName, coverUrl, creatorUsername, attendees, attendeeCount } = props;
    const { editor, hasOverlap, previewBlocks, modalHourRange, eventTimeLabel } = useGameTimeWidgetData(props);
    const [showModal, setShowModal] = useState(false);
    const [popoverEvent, setPopoverEvent] = useState<{ event: GameTimeEventBlock; anchorRect: DOMRect } | null>(null);
    const handleEventClick = useCallback((event: GameTimeEventBlock, anchorRect: DOMRect) => { setPopoverEvent({ event, anchorRect }); }, []);
    if (editor.isLoading) return null;

    return (
        <>
            <div className="flex items-center gap-2 h-full min-h-[2.75rem] px-3 rounded-lg cursor-pointer transition-colors"
                style={{ background: 'var(--gt-widget-bg)', backdropFilter: 'blur(8px)', border: hasOverlap ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid var(--gt-widget-border)' }}
                onClick={() => setShowModal(true)} data-testid="game-time-widget">
                <OverlapBadge hasOverlap={hasOverlap} />
                <svg className="w-3 h-3 text-dim ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
            </div>
            {showModal && <GameTimeWidgetModal editor={editor} previewBlocks={previewBlocks} modalHourRange={modalHourRange}
                eventTitle={eventTitle} coverUrl={coverUrl} gameName={gameName} eventTimeLabel={eventTimeLabel}
                creatorUsername={creatorUsername} attendees={attendees} attendeeCount={attendeeCount}
                onClose={() => setShowModal(false)} onEventClick={handleEventClick} />}
            {popoverEvent && <EventBlockPopover event={popoverEvent.event} anchorRect={popoverEvent.anchorRect} onClose={() => setPopoverEvent(null)} />}
        </>
    );
}

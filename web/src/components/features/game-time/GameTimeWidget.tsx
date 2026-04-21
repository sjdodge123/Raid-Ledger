import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameTimeEditor } from '../../../hooks/use-game-time-editor';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { Modal } from '../../ui/modal';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimePreviewBlock } from './GameTimeGrid';
import { MemberAvatarGroup } from '../../lineups/decided/MemberAvatarGroup';
import { checkGameTimeOverlap, walkEventHours } from './game-time-overlap.utils';

interface AttendeePreview {
    id: number;
    username: string;
    avatar: string | null;
    customAvatarUrl?: string | null;
    discordId?: string | null;
    characters?: Array<{ gameId: number | string; name?: string; avatarUrl: string | null }>;
}

interface GameTimeWidgetProps {
    eventStartTime: string;
    eventEndTime: string;
    eventTitle?: string;
    gameName?: string;
    gameSlug?: string;
    gameId?: number | null;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string | null;
    attendees?: AttendeePreview[];
    attendeeCount?: number;
}

function collectDayHours(startTime: string, endTime: string): Map<number, number[]> {
    const dayHours = new Map<number, number[]>();
    walkEventHours(startTime, endTime, (dayOfWeek, hour) => {
        const hours = dayHours.get(dayOfWeek) ?? [];
        hours.push(hour);
        dayHours.set(dayOfWeek, hours);
    });
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

function EventDetailCard({ title, coverUrl, gameName, gameId, timeLabel, creatorUsername, attendees }: {
    title: string; coverUrl?: string | null; gameName?: string; timeLabel: string; creatorUsername?: string | null;
    gameId?: number | null; attendees?: AttendeePreview[];
}) {
    return (
        <div className="rounded-lg border border-edge bg-panel/50 overflow-hidden">
            <div className="flex items-start gap-3 p-3">
                {coverUrl && <div className="w-14 h-14 rounded-lg bg-cover bg-center shrink-0 ring-1 ring-white/10" style={{ backgroundImage: `url(${coverUrl})` }} />}
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Highlighted Event</p>
                    <h4 className="text-sm font-semibold text-foreground truncate mt-1">{title}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                        {gameName && <span>{gameName}</span>}
                        {gameName && timeLabel && <span className="text-faint">·</span>}
                        {timeLabel && <span>{timeLabel}</span>}
                    </div>
                    {creatorUsername && <p className="text-[11px] text-dim mt-1">Hosted by {creatorUsername}</p>}
                </div>
                {attendees && attendees.length > 0 && (
                    <div className="shrink-0 self-center">
                        <MemberAvatarGroup
                            members={attendees.map((attendee) => ({
                                userId: attendee.id,
                                displayName: attendee.username,
                                avatar: attendee.avatar,
                                discordId: attendee.discordId ?? null,
                                customAvatarUrl: attendee.customAvatarUrl ?? null,
                                characters: attendee.characters,
                            }))}
                            max={4}
                            gameId={gameId ?? undefined}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function useGameTimeWidgetData(props: GameTimeWidgetProps) {
    const { eventStartTime, eventEndTime, eventTitle } = props;
    const editor = useGameTimeEditor({ enabled: true, rolling: false });
    const hasOverlap = useMemo(() => checkGameTimeOverlap(editor.slots, eventStartTime, eventEndTime), [editor.slots, eventStartTime, eventEndTime]);
    const previewBlocks = useMemo<GameTimePreviewBlock[]>(() => {
        const dayHours = collectDayHours(eventStartTime, eventEndTime);
        const meta = { label: eventTitle ?? 'This Event', variant: 'selected' as const };
        return buildPreviewBlocks(dayHours, meta);
    }, [eventStartTime, eventEndTime, eventTitle]);
    const eventTimeLabel = useMemo(() => formatTimeLabel(eventStartTime, eventEndTime), [eventStartTime, eventEndTime]);
    return { editor, hasOverlap, previewBlocks, eventTimeLabel };
}

function GameTimeWidgetModal({ editor, previewBlocks, eventTitle, coverUrl, gameName, gameId, eventTimeLabel, creatorUsername, attendees, onClose }: {
    editor: ReturnType<typeof useGameTimeEditor>; previewBlocks: GameTimePreviewBlock[];
    eventTitle?: string; coverUrl?: string | null; gameName?: string; gameId?: number | null; eventTimeLabel: string; creatorUsername?: string | null;
    attendees?: AttendeePreview[];
    onClose: () => void;
}) {
    const isMobile = useMediaQuery('(max-width: 767px)');

    return (
        <Modal isOpen onClose={onClose} title="My Game Time" maxWidth="max-w-3xl">
            <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-muted text-xs">Read-only view — your weekly availability with this event highlighted.</p>
                        <p className="text-dim text-xs mt-1">Uses the same compact weekly layout as profile and scheduling.</p>
                    </div>
                    <Link
                        to="/profile/gaming"
                        onClick={onClose}
                        className="inline-flex items-center justify-center rounded-lg border border-edge bg-panel px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-overlay transition-colors"
                    >
                        Edit my game time &rarr;
                    </Link>
                </div>
                <div className="rounded-lg border border-edge overflow-hidden">
                    <GameTimeGrid
                        slots={editor.slots}
                        readOnly
                        tzLabel={editor.tzLabel}
                        previewBlocks={previewBlocks}
                        hourRange={[9, 2]}
                        compact
                        noStickyOffset
                        fullDayNames={!isMobile}
                    />
                </div>
                {eventTitle && <EventDetailCard title={eventTitle} coverUrl={coverUrl} gameName={gameName} gameId={gameId} timeLabel={eventTimeLabel} creatorUsername={creatorUsername} attendees={attendees} />}
            </div>
        </Modal>
    );
}

export function GameTimeWidget(props: GameTimeWidgetProps) {
    const { eventTitle, gameName, gameId, coverUrl, creatorUsername, attendees } = props;
    const { editor, hasOverlap, previewBlocks, eventTimeLabel } = useGameTimeWidgetData(props);
    const [showModal, setShowModal] = useState(false);
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
            {showModal && <GameTimeWidgetModal editor={editor} previewBlocks={previewBlocks}
                eventTitle={eventTitle} coverUrl={coverUrl} gameName={gameName} gameId={gameId} eventTimeLabel={eventTimeLabel}
                creatorUsername={creatorUsername} attendees={attendees}
                onClose={() => setShowModal(false)} />}
        </>
    );
}

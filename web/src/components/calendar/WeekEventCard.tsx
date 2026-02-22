import { format, differenceInMinutes } from 'date-fns';
import { getGameColors } from '../../constants/game-colors';
import { AttendeeAvatars } from './AttendeeAvatars';
import type { CalendarEvent } from './CalendarView';

interface WeekEventCardProps {
    event: CalendarEvent;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
}

type Tier = 'minimal' | 'compact' | 'standard';

function getTier(durationMins: number): Tier {
    if (durationMins < 150) return 'minimal';
    if (durationMins <= 240) return 'compact';
    return 'standard';
}

/**
 * Week view event card with duration-aware rendering tiers.
 * Extracted from CalendarView's inline WeekEventComponent.
 *
 * Tiers:
 * - minimal (<2.5hr): 1-line title, time, signup badge, no avatars, tight padding
 * - compact (2.5-4hr): 2-line title, game, time, xs avatars (max 3)
 * - standard (>4hr): 2-line title, game, time, sm avatars (max 5)
 */
export function WeekEventCard({ event, eventOverlapsGameTime }: WeekEventCardProps) {
    const gameSlug = event.resource?.game?.slug || 'default';
    const coverUrl = event.resource?.game?.coverUrl;
    const gameName = event.resource?.game?.name || 'Event';
    const signupCount = event.resource?.signupCount ?? 0;
    const signupsPreview = event.resource?.signupsPreview;
    const colors = getGameColors(gameSlug);
    const overlaps = eventOverlapsGameTime(event.start, event.end);

    const startTime = format(event.start, 'h:mm a');
    const endTime = event.end ? format(event.end, 'h:mm a') : '';

    const durationMins = event.end ? differenceInMinutes(event.end, event.start) : 0;
    const tier = getTier(durationMins);

    const avatarConfig = tier === 'compact'
        ? { size: 'xs' as const, max: 3 }
        : tier === 'standard'
            ? { size: 'sm' as const, max: 5 }
            : null;

    return (
        <div
            className={`week-event-block week-event-block--${tier}`}
            data-tier={tier}
            style={{
                backgroundImage: coverUrl
                    ? `linear-gradient(180deg, ${colors.bg}f5 0%, ${colors.bg}ee 60%, ${colors.bg}cc 100%), url(${coverUrl})`
                    : `linear-gradient(180deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderLeft: `3px solid ${colors.border}`,
            }}
        >
            <div className="week-event-header" style={{ position: 'relative' }}>
                <span className={`week-event-title ${tier === 'minimal' ? 'week-event-title--minimal' : ''}`}>
                    {event.title}
                </span>
                {overlaps && (
                    <span
                        className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400"
                        style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }}
                        title="Overlaps with your game time"
                    />
                )}
            </div>
            <div className="week-event-details">
                <span className="week-event-game">{gameName}</span>
                <span className="week-event-time">
                    {startTime}{endTime ? ` - ${endTime}` : ''}
                </span>
                {/* Avatars for compact/standard tiers */}
                {avatarConfig && signupsPreview && signupsPreview.length > 0 ? (
                    <div className="week-event-attendees">
                        <AttendeeAvatars
                            signups={signupsPreview}
                            totalCount={signupCount}
                            size={avatarConfig.size}
                            maxVisible={avatarConfig.max}
                            accentColor={colors.border}
                            gameId={event.resource?.game?.id ?? undefined}
                        />
                    </div>
                ) : signupCount > 0 ? (
                    <span className="week-event-signup-badge" data-testid="signup-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '4px', verticalAlign: 'middle' }}>
                            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                        </svg>
                        {signupCount}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

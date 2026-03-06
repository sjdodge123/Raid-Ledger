import { getGameColors } from '../../../constants/game-colors';
import { AttendeeAvatars } from '../../calendar/AttendeeAvatars';

/** Duration badge (dark pill with hour count) */
function DurationBadge({ hours }: { hours: number }) {
    return (
        <span className="inline-flex items-center px-1 py-px rounded text-[8px] font-bold text-foreground/90 bg-black/40 leading-none">
            {hours}h
        </span>
    );
}

interface RichEventBlockProps {
    event: {
        title: string;
        gameName?: string | null;
        gameSlug?: string | null;
        coverUrl?: string | null;
        startHour: number;
        endHour: number;
        description?: string | null;
        creatorUsername?: string | null;
        gameId?: number | null;
        signupsPreview?: Array<{
            id: number;
            username: string;
            avatar: string | null;
            characters?: Array<{ gameId: number; avatarUrl: string | null }>;
        }>;
        signupCount?: number;
    };
    spanHours: number;
}

/** Rich event block content — adaptive tiers based on span */
export function RichEventBlock({ event, spanHours }: RichEventBlockProps) {
    const colors = getGameColors(event.gameSlug ?? undefined);

    if (spanHours >= 3) {
        return (
            <div className="px-1.5 py-1 h-full flex flex-col gap-0.5 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1">
                    <DurationBadge hours={spanHours} />
                    <span className="text-[10px] font-semibold leading-tight truncate text-foreground">
                        {event.title}
                    </span>
                </div>
                {event.gameName && (
                    <span className="text-[9px] text-foreground/60 leading-tight truncate">
                        {event.gameName}
                    </span>
                )}
                {event.creatorUsername && spanHours >= 4 && (
                    <span className="text-[8px] text-foreground/40 leading-tight truncate">
                        by {event.creatorUsername}
                    </span>
                )}
                {event.description && spanHours >= 5 && (
                    <span className="text-[8px] text-foreground/40 leading-tight line-clamp-2">
                        {event.description}
                    </span>
                )}
                {event.signupsPreview && event.signupsPreview.length > 0 && (
                    <div className="mt-auto">
                        <AttendeeAvatars
                            signups={event.signupsPreview}
                            totalCount={event.signupCount ?? event.signupsPreview.length}
                            maxVisible={3}
                            size="xs"
                            accentColor={colors.border}
                            gameId={event.gameId ?? undefined}
                        />
                    </div>
                )}
            </div>
        );
    }

    if (spanHours === 2) {
        return (
            <div className="px-1 py-0.5 h-full flex flex-col gap-0.5 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1">
                    <DurationBadge hours={spanHours} />
                    <span className="text-[10px] font-semibold leading-tight truncate text-foreground">
                        {event.title}
                    </span>
                </div>
                {event.gameName && (
                    <span className="text-[9px] text-foreground/60 leading-tight truncate">
                        {event.gameName}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className="px-1 py-0.5 h-full flex items-center min-w-0 overflow-hidden">
            <span className="text-[10px] font-medium leading-tight truncate text-foreground">
                {event.title}
            </span>
        </div>
    );
}

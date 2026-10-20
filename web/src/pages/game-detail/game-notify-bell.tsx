/**
 * The per-game notification bell (ROK-1797), beside the heart on the game page
 * — an adapter feeding the shared `NotifyBell` (ROK-1832) from
 * `useGameNotificationMute`. Rendered inside the page's authenticated row, so
 * it needs no auth guard of its own, and it shows whether or not the game is
 * hearted. `?action=notifications` opens the panel (`useGameNotifyDeepLink`).
 */
import { useCallback, useState, type JSX } from 'react';
import { NotifyBell } from '../../components/notifications/notify-bell';
import { useGameNotificationMute } from '../../hooks/use-game-notification-mute';
import { useGameNotifyDeepLink } from './use-game-notify-deep-link';

export const NOTIFICATION_SETTINGS_HREF = '/profile/notifications#notif-subscribed_game';
const GAME_MUTED_HINT = 'Muting only silences notifications. Your heart stays as it is.';

export function GameNotifyBell({ gameId, gameName }: { gameId: number; gameName: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    const openPanel = useCallback(() => setOpen(true), []);
    const { muted, isReady, isPending, setMuted } = useGameNotificationMute(gameId);
    useGameNotifyDeepLink(isReady, openPanel);
    return (
        <NotifyBell subjectName={gameName} muted={muted} isReady={isReady} isPending={isPending} onToggle={setMuted}
            settingsHref={NOTIFICATION_SETTINGS_HREF} testIdPrefix="game-notify" mutedHint={GAME_MUTED_HINT}
            open={open} onOpenChange={setOpen} />
    );
}

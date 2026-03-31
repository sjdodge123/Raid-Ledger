/**
 * Dismissible banner prompting users without Steam linked to connect
 * during the lineup building phase (ROK-993).
 */
import { useState } from 'react';
import { useSteamLink } from '../../hooks/use-steam-link';

interface SteamNudgeBannerProps {
    lineupId: number;
    lineupStatus: string;
    userSteamId: string | null;
}

const STORAGE_KEY_PREFIX = 'raid_ledger_steam_nudge_dismissed_';

function isDismissed(lineupId: number): boolean {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${lineupId}`) === 'true';
}

/** Banner action buttons — Link Steam CTA and dismiss. */
function BannerActions({ onDismiss }: { onDismiss: () => void }) {
    const { linkSteam } = useSteamLink();
    return (
        <div className="ml-4 flex items-center gap-2">
            <button
                type="button"
                onClick={() => linkSteam()}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
                Link Steam
            </button>
            <button
                type="button"
                aria-label="Dismiss"
                onClick={onDismiss}
                className="text-blue-500 hover:text-blue-700 dark:text-blue-400"
            >
                &times;
            </button>
        </div>
    );
}

export function SteamNudgeBanner({ lineupId, lineupStatus, userSteamId }: SteamNudgeBannerProps) {
    const [dismissed, setDismissed] = useState(() => isDismissed(lineupId));

    if (userSteamId || lineupStatus !== 'building' || dismissed) {
        return null;
    }

    const handleDismiss = () => {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${lineupId}`, 'true');
        setDismissed(true);
    };

    return (
        <div className="flex items-center justify-between rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
            <p>Connect your account to include your game library in suggestions.</p>
            <BannerActions onDismiss={handleDismiss} />
        </div>
    );
}

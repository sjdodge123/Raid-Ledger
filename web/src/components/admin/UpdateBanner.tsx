import { useState } from 'react';
import { useUpdateStatus } from '../../hooks/use-version';

const RELEASES_FALLBACK_URL = 'https://github.com/sjdodge123/Raid-Ledger/releases';
const DISMISS_KEY_PREFIX = 'raid_ledger_update_banner_dismissed_v';

const WarningIcon = (
    <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
);

const CloseIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
);

function dismissKey(latestVersion: string): string {
    return `${DISMISS_KEY_PREFIX}${latestVersion}`;
}

function readDismissed(latestVersion: string): boolean {
    try {
        return sessionStorage.getItem(dismissKey(latestVersion)) === '1';
    } catch {
        return false;
    }
}

function writeDismissed(latestVersion: string): void {
    try {
        sessionStorage.setItem(dismissKey(latestVersion), '1');
    } catch {
        // Private mode / blocked storage — fall back to in-memory state.
    }
}

function BannerContent({ data }: { data: { latestVersion: string; currentVersion: string; latestReleaseUrl: string | null } }) {
    const href = data.latestReleaseUrl ?? RELEASES_FALLBACK_URL;
    return (
        <div className="flex items-start gap-3">
            {WarningIcon}
            <div>
                <p className="text-sm text-amber-300 font-medium">
                    A new version of Raid Ledger is available (v{data.latestVersion}). You are running v{data.currentVersion}.
                </p>
                <a href={href} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-amber-400 hover:text-amber-300 underline underline-offset-2 mt-1 inline-block">
                    View release notes
                </a>
            </div>
        </div>
    );
}

function BannerView({ latestVersion, currentVersion, latestReleaseUrl, onDismiss }: {
    latestVersion: string; currentVersion: string; latestReleaseUrl: string | null; onDismiss: () => void;
}) {
    return (
        <div role="status" className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start justify-between gap-3">
            <BannerContent data={{ latestVersion, currentVersion, latestReleaseUrl }} />
            <button onClick={onDismiss} className="text-amber-400/60 hover:text-amber-300 transition-colors flex-shrink-0" aria-label="Dismiss update banner">
                {CloseIcon}
            </button>
        </div>
    );
}

/**
 * Admin update banner (ROK-294 + ROK-1242).
 * Shows a warning when a newer version is available on GitHub.
 * Dismissal persists for the session via sessionStorage, keyed by latest
 * version so a NEW release re-surfaces the banner. Falls back to in-memory
 * dismissal when sessionStorage is unavailable (private mode).
 */
export function UpdateBanner({ enabled }: { enabled: boolean }) {
    const { data } = useUpdateStatus(enabled);
    const [memoryDismissed, setMemoryDismissed] = useState<string | null>(null);

    if (!data?.updateAvailable || !data.latestVersion) return null;
    if (memoryDismissed === data.latestVersion) return null;
    if (readDismissed(data.latestVersion)) return null;

    const onDismiss = () => {
        const v = data.latestVersion as string;
        writeDismissed(v);
        setMemoryDismissed(v);
    };

    return (
        <BannerView
            latestVersion={data.latestVersion}
            currentVersion={data.currentVersion}
            latestReleaseUrl={data.latestReleaseUrl}
            onDismiss={onDismiss}
        />
    );
}

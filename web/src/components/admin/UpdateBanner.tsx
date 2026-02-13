import { useState } from 'react';
import { useUpdateStatus } from '../../hooks/use-version';

/**
 * Admin update banner (ROK-294).
 * Shows a warning when a newer version is available on GitHub.
 * Dismissible per page load (returns on next navigation).
 */
export function UpdateBanner({ enabled }: { enabled: boolean }) {
    const { data } = useUpdateStatus(enabled);
    const [dismissed, setDismissed] = useState(false);

    if (!data?.updateAvailable || dismissed) return null;

    return (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
                <svg
                    className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                </svg>
                <div>
                    <p className="text-sm text-amber-300 font-medium">
                        A new version of Raid Ledger is available (v{data.latestVersion}).
                        You are running v{data.currentVersion}.
                    </p>
                    <a
                        href="https://github.com/sjdodge123/Raid-Ledger/Releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-amber-400 hover:text-amber-300 underline underline-offset-2 mt-1 inline-block"
                    >
                        View releases on GitHub
                    </a>
                </div>
            </div>
            <button
                onClick={() => setDismissed(true)}
                className="text-amber-400/60 hover:text-amber-300 transition-colors flex-shrink-0"
                aria-label="Dismiss update banner"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
        </div>
    );
}

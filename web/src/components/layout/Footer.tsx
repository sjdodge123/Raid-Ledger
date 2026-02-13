import { useVersionInfo } from '../../hooks/use-version';

/**
 * Footer component with copyright, version display, and relay hub indicator (ROK-294).
 */
export function Footer() {
    const currentYear = new Date().getFullYear();
    const { data: versionInfo } = useVersionInfo();

    return (
        <footer className="bg-surface border-t border-edge-subtle py-6 px-4">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-dim text-sm">
                    &copy; {currentYear} Raid Ledger. All rights reserved.
                </p>
                <div className="flex items-center gap-6">
                    {/* Version + Relay Hub indicator */}
                    <div className="flex items-center gap-2">
                        {versionInfo && (
                            <span className="text-dim text-xs">
                                v{versionInfo.version}
                            </span>
                        )}
                        <span
                            className="relative group"
                            aria-label="Relay Hub - Coming Soon"
                        >
                            <svg
                                className="w-3.5 h-3.5 text-dim/40"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
                                />
                            </svg>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-foreground bg-panel border border-edge rounded shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
                                Relay Hub &mdash; Coming Soon
                            </span>
                        </span>
                    </div>
                    <a
                        href="https://github.com/sjdodge123/Raid-Ledger"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-dim hover:text-secondary transition-colors text-sm"
                    >
                        GitHub
                    </a>
                </div>
            </div>
        </footer>
    );
}

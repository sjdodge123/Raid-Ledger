import { useVersionInfo } from '../../hooks/use-version';

/**
 * Footer component with copyright and version display.
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
                    {versionInfo && (
                        <span className="text-dim text-xs">
                            v{versionInfo.version}
                        </span>
                    )}
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

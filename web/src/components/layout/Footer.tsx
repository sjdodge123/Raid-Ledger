import { useVersionInfo } from '../../hooks/use-version';

/**
 * ROK-1661: iPad Safari lets any page scroll to the bottom of its layout
 * viewport, ~85–130 CSS px past a short page's end, and showed a blank band
 * under the footer there. This paints that run-out in the footer's colour. A
 * shadow is ink overflow, so it never adds scroll height (the shell's floor
 * stays the visible viewport, `use-shell-height.ts`), and the shell's
 * `overflow-x: clip` trims its sideways spread.
 */
const FOOTER_RUNOUT_SHADOW = { boxShadow: '0 100lvh 0 100lvh var(--color-surface)' };

/**
 * Footer component with copyright and version display.
 */
export function Footer() {
    const currentYear = new Date().getFullYear();
    const { data: versionInfo } = useVersionInfo();

    return (
        <footer className="hidden md:block bg-surface border-t border-edge-subtle py-6 px-4" style={FOOTER_RUNOUT_SHADOW}>
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

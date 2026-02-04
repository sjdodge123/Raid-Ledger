/**
 * Footer component with copyright and optional links.
 */
export function Footer() {
    const currentYear = new Date().getFullYear();

    return (
        <footer className="bg-slate-900 border-t border-slate-800 py-6 px-4">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-slate-500 text-sm">
                    © {currentYear} Raid Ledger. All rights reserved.
                </p>
                <div className="flex items-center gap-6">
                    <a
                        href="https://github.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
                    >
                        GitHub
                    </a>
                </div>
            </div>
        </footer>
    );
}

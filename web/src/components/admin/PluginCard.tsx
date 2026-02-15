import type { PluginInfoDto } from '@raid-ledger/contract';

interface PluginCardProps {
    plugin: PluginInfoDto;
    onInstall: (slug: string) => void;
    onUninstall: (slug: string) => void;
    onActivate: (slug: string) => void;
    onDeactivate: (slug: string) => void;
    isPending: boolean;
}

const STATUS_STYLES = {
    active: 'bg-emerald-500/20 text-emerald-400',
    inactive: 'bg-amber-500/20 text-amber-400',
    not_installed: 'bg-gray-500/20 text-gray-400',
} as const;

const STATUS_LABELS = {
    active: 'Active',
    inactive: 'Inactive',
    not_installed: 'Not Installed',
} as const;

function formatRelativeDate(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function PluginCard({
    plugin,
    onInstall,
    onUninstall,
    onActivate,
    onDeactivate,
    isPending,
}: PluginCardProps) {
    return (
        <div className="bg-panel/50 backdrop-blur-sm rounded-xl border border-edge/50 p-5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground truncate">
                        {plugin.name}
                    </h3>
                    <span className="text-xs text-dim bg-overlay px-2 py-0.5 rounded-full whitespace-nowrap">
                        v{plugin.version}
                    </span>
                </div>
                <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[plugin.status]}`}
                >
                    {STATUS_LABELS[plugin.status]}
                </span>
            </div>

            {/* Author */}
            <p className="text-sm text-muted mb-2">
                by{' '}
                {plugin.author.url ? (
                    <a
                        href={plugin.author.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground transition-colors"
                    >
                        {plugin.author.name}
                    </a>
                ) : (
                    plugin.author.name
                )}
            </p>

            {/* Description */}
            <p className="text-sm text-secondary mb-3">{plugin.description}</p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5 mb-3">
                {plugin.gameSlugs.map((slug) => (
                    <span
                        key={slug}
                        className="text-xs bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded"
                    >
                        {slug}
                    </span>
                ))}
                {plugin.capabilities.map((cap) => (
                    <span
                        key={cap}
                        className="text-xs bg-purple-500/15 text-purple-400 px-2 py-0.5 rounded"
                    >
                        {cap}
                    </span>
                ))}
            </div>

            {/* Integration health */}
            {plugin.integrations.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3 text-sm">
                    {plugin.integrations.map((integration) => (
                        <div key={integration.key} className="flex items-center gap-1.5">
                            <div
                                className={`w-2 h-2 rounded-full ${integration.configured ? 'bg-emerald-400' : 'bg-red-400'
                                    }`}
                            />
                            <span className="text-secondary">{integration.name}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Installed date */}
            {plugin.installedAt && (
                <p className="text-xs text-dim mb-3">
                    Installed {formatRelativeDate(plugin.installedAt)}
                </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
                {plugin.status === 'not_installed' && (
                    <button
                        onClick={() => onInstall(plugin.slug)}
                        disabled={isPending}
                        className="px-3 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                    >
                        Install
                    </button>
                )}
                {plugin.status === 'active' && (
                    <button
                        onClick={() => onDeactivate(plugin.slug)}
                        disabled={isPending}
                        className="px-3 py-2.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                    >
                        Deactivate
                    </button>
                )}
                {plugin.status === 'inactive' && (
                    <>
                        <button
                            onClick={() => onActivate(plugin.slug)}
                            disabled={isPending}
                            className="px-3 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors"
                        >
                            Activate
                        </button>
                        <button
                            onClick={() => onUninstall(plugin.slug)}
                            disabled={isPending}
                            className="px-3 py-2.5 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium rounded-lg transition-colors border border-red-600/50"
                        >
                            Uninstall
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

import type { PluginInfoDto } from '@raid-ledger/contract';

const STATUS_CONFIG = {
    not_installed: { label: 'Not Installed', className: 'bg-surface/50 text-muted border border-edge/50' },
    inactive: { label: 'Installed (Inactive)', className: 'bg-amber-500/10 text-amber-400 border border-amber-500/30' },
    active: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
} as const;

interface PluginCardProps {
    plugin: PluginInfoDto;
    isPending: boolean;
    onInstall: (slug: string) => void;
    onActivate: (slug: string) => void;
}

export function PluginCard({ plugin, isPending, onInstall, onActivate }: PluginCardProps) {
    const status = STATUS_CONFIG[plugin.status];

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground">{plugin.name}</h3>
                        <span className="text-xs text-dim">{plugin.version}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${status.className}`}>
                            {status.label}
                        </span>
                    </div>
                    <p className="text-xs text-muted mt-1">{plugin.description}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {plugin.status === 'not_installed' && (
                        <button onClick={() => onInstall(plugin.slug)} disabled={isPending}
                            className="px-4 py-2.5 min-h-[44px] text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                            Install
                        </button>
                    )}
                    {plugin.status === 'inactive' && (
                        <button onClick={() => onActivate(plugin.slug)} disabled={isPending}
                            className="px-4 py-2.5 min-h-[44px] text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                            Activate
                        </button>
                    )}
                    {plugin.status === 'active' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Ready
                        </span>
                    )}
                </div>
            </div>

            {plugin.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {plugin.capabilities.map((cap) => (
                        <span key={cap} className="px-2 py-0.5 text-[10px] rounded-full bg-overlay text-secondary">{cap}</span>
                    ))}
                </div>
            )}

            {plugin.gameSlugs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {plugin.gameSlugs.map((slug) => (
                        <span key={slug} className="px-2 py-0.5 text-[10px] rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">{slug}</span>
                    ))}
                </div>
            )}

            {plugin.integrations.length > 0 && plugin.status === 'active' && (
                <div className="border-t border-edge/30 pt-2 mt-2">
                    <span className="text-[10px] font-medium text-dim uppercase tracking-wider">Integrations</span>
                    <div className="mt-1 space-y-1">
                        {plugin.integrations.map((integration) => (
                            <div key={integration.key} className="flex items-center gap-2 text-xs">
                                {integration.icon && <span className="text-sm">{integration.icon}</span>}
                                <span className="text-secondary">{integration.name}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${integration.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                                    {integration.configured ? 'Online' : 'Offline'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

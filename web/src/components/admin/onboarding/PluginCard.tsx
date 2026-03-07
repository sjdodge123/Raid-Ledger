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

function PluginActionButton({ plugin, isPending, onInstall, onActivate }: PluginCardProps) {
    if (plugin.status === 'not_installed') {
        return (
            <button onClick={() => onInstall(plugin.slug)} disabled={isPending}
                className="px-4 py-2.5 min-h-[44px] text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                Install
            </button>
        );
    }
    if (plugin.status === 'inactive') {
        return (
            <button onClick={() => onActivate(plugin.slug)} disabled={isPending}
                className="px-4 py-2.5 min-h-[44px] text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                Activate
            </button>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Ready
        </span>
    );
}

function PluginIntegrations({ integrations }: { integrations: PluginInfoDto['integrations'] }) {
    if (integrations.length === 0) return null;
    return (
        <div className="border-t border-edge/30 pt-2 mt-2">
            <span className="text-[10px] font-medium text-dim uppercase tracking-wider">Integrations</span>
            <div className="mt-1 space-y-1">
                {integrations.map((i) => (
                    <div key={i.key} className="flex items-center gap-2 text-xs">
                        {i.icon && <span className="text-sm">{i.icon}</span>}
                        <span className="text-secondary">{i.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${i.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                            {i.configured ? 'Online' : 'Offline'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PluginHeader({ plugin }: { plugin: PluginInfoDto }) {
    const status = STATUS_CONFIG[plugin.status];
    return (
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">{plugin.name}</h3>
                <span className="text-xs text-dim">{plugin.version}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${status.className}`}>{status.label}</span>
            </div>
            <p className="text-xs text-muted mt-1">{plugin.description}</p>
        </div>
    );
}

function TagList({ items, className }: { items: string[]; className: string }) {
    if (items.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map((item) => <span key={item} className={`px-2 py-0.5 text-[10px] rounded-full ${className}`}>{item}</span>)}
        </div>
    );
}

export function PluginCard(props: PluginCardProps) {
    const { plugin } = props;

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                <PluginHeader plugin={plugin} />
                <div className="flex items-center gap-2 flex-shrink-0"><PluginActionButton {...props} /></div>
            </div>
            <TagList items={plugin.capabilities} className="bg-overlay text-secondary" />
            <TagList items={plugin.gameSlugs} className="bg-blue-500/10 text-blue-400 border border-blue-500/20" />
            {plugin.status === 'active' && <PluginIntegrations integrations={plugin.integrations} />}
        </div>
    );
}

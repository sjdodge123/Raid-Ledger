import type { JSX } from 'react';
import { useNewBadge } from '../../../hooks/use-new-badge';
import { getPluginBadge } from '../../../plugins/plugin-registry';
import { AdminPluginSection } from '../../../components/admin/AdminPluginSection';
import { NewBadge } from '../../../components/ui/new-badge';
import type { PluginInfoDto } from '@raid-ledger/contract';

interface PluginCardProps {
    plugin: PluginInfoDto;
    isPending: boolean;
    onInstall: (slug: string) => void;
    onActivate: (slug: string) => void;
    onDeactivate: (slug: string) => void;
    onUninstall: (slug: string) => void;
}

/** Full plugin card with author, capabilities, game slugs, integrations */
export function PluginCard({
    plugin, isPending, onInstall, onActivate, onDeactivate, onUninstall,
}: PluginCardProps): JSX.Element {
    const { isNew, markSeen } = useNewBadge(`plugin-seen:${plugin.slug}`);
    const pluginBadge = getPluginBadge(plugin.slug);
    const actionButtons = <PluginCardActions plugin={plugin} isPending={isPending} onInstall={onInstall} onActivate={onActivate} onDeactivate={onDeactivate} onUninstall={onUninstall} />;

    return (
        <AdminPluginSection title={plugin.name} version={plugin.version} description={plugin.description}
            status={plugin.status} badge={<NewBadge visible={isNew} />} pluginBadge={pluginBadge}
            onMouseEnter={markSeen} actions={actionButtons}>
            <PluginCardDetails plugin={plugin} />
        </AdminPluginSection>
    );
}

function PluginCardActions({ plugin, isPending, onInstall, onActivate, onDeactivate, onUninstall }: {
    plugin: PluginInfoDto; isPending: boolean;
    onInstall: (slug: string) => void; onActivate: (slug: string) => void;
    onDeactivate: (slug: string) => void; onUninstall: (slug: string) => void;
}): JSX.Element {
    return (
        <>
            {plugin.status === 'not_installed' && (
                <button onClick={() => onInstall(plugin.slug)} disabled={isPending}
                    className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">Install</button>
            )}
            {plugin.status === 'active' && (
                <button onClick={() => onDeactivate(plugin.slug)} disabled={isPending}
                    className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">Deactivate</button>
            )}
            {plugin.status === 'inactive' && (
                <>
                    <button onClick={() => onActivate(plugin.slug)} disabled={isPending}
                        className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">Activate</button>
                    <button onClick={() => onUninstall(plugin.slug)} disabled={isPending}
                        className="px-3 py-1.5 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium rounded-lg transition-colors border border-red-600/50">Uninstall</button>
                </>
            )}
        </>
    );
}

/** Plugin details: author, capabilities, game slugs, integrations, install date */
function PluginCardDetails({ plugin }: { plugin: PluginInfoDto }): JSX.Element {
    return (
        <>
            <PluginAuthor author={plugin.author} />
            <TagList label="Capabilities" items={plugin.capabilities} className="px-2 py-0.5 text-xs rounded-full bg-overlay text-secondary" />
            <TagList label="Supported Games" items={plugin.gameSlugs} className="px-2 py-0.5 text-xs rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20" />
            {plugin.integrations.length > 0 && <IntegrationsList integrations={plugin.integrations} />}
            {plugin.installedAt && (
                <p className="text-xs text-dim">
                    Installed {new Date(plugin.installedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
            )}
        </>
    );
}

function PluginAuthor({ author }: { author: { name: string; url?: string | null } }): JSX.Element {
    return (
        <div className="flex items-center gap-2 text-sm">
            <span className="text-dim">Author:</span>
            {author.url ? (
                <a href={author.url} target="_blank" rel="noopener noreferrer"
                    className="text-secondary hover:text-foreground underline underline-offset-2 transition-colors">{author.name}</a>
            ) : (
                <span className="text-secondary">{author.name}</span>
            )}
        </div>
    );
}

function TagList({ label, items, className }: { label: string; items: string[]; className: string }): JSX.Element | null {
    if (items.length === 0) return null;
    return (
        <div>
            <span className="text-xs font-medium text-dim uppercase tracking-wider">{label}</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
                {items.map((item) => (<span key={item} className={className}>{item}</span>))}
            </div>
        </div>
    );
}

/** Plugin integrations list */
function IntegrationsList({ integrations }: {
    integrations: { key: string; name: string; description: string; configured: boolean; icon?: string }[];
}): JSX.Element {
    return (
        <div>
            <span className="text-xs font-medium text-dim uppercase tracking-wider">Integrations</span>
            <div className="mt-1.5 space-y-2">
                {integrations.map((integration) => (
                    <div key={integration.key} className="flex items-start gap-3 p-2.5 rounded-lg bg-surface/30 border border-edge/30">
                        {integration.icon && <span className="text-lg flex-shrink-0 mt-0.5">{integration.icon}</span>}
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{integration.name}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    integration.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
                                }`}>{integration.configured ? 'Configured' : 'Not Configured'}</span>
                            </div>
                            <p className="text-xs text-muted mt-0.5">{integration.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

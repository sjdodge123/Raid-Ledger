import { useState } from 'react';
import { usePluginAdmin } from '../../../hooks/use-plugin-admin';
import { toast } from '../../../lib/toast';
import type { PluginInfoDto } from '@raid-ledger/contract';
import { PluginCard } from './PluginCard';

interface ConnectPluginsStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const STUB_PLUGIN: PluginInfoDto = {
  slug: 'core-features',
  name: 'Core Community Features',
  version: '1.0.0',
  description: 'Enables event scheduling, roster management, and community calendar -- the essentials for any gaming community.',
  author: { name: 'Raid Ledger' },
  gameSlugs: [],
  capabilities: ['events', 'roster', 'calendar'],
  integrations: [],
  status: 'not_installed',
  installedAt: null,
};

function PluginsLoadingState() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Install Plugins</h2>
                <p className="text-sm text-muted mt-1">Loading available plugins...</p>
            </div>
            <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-panel/50 rounded-lg border border-edge/30" />)}
            </div>
        </div>
    );
}

function PluginsErrorState({ onBack, onSkip }: { onBack: () => void; onSkip: () => void }) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Install Plugins</h2>
                <p className="text-sm text-red-400 mt-1">Failed to load plugins. You can configure them later in Admin Settings.</p>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-edge/30">
                <button onClick={onBack} className="px-5 py-2.5 min-h-[44px] bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm">Back</button>
                <button onClick={onSkip} className="px-6 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm">Skip</button>
            </div>
        </div>
    );
}

function usePluginHandlers() {
    const { plugins, install, activate } = usePluginAdmin();
    const [stubEnabled, setStubEnabled] = useState(false);

    const handleInstallAndActivate = async (slug: string) => {
        if (slug === STUB_PLUGIN.slug) { setStubEnabled(true); toast.success('Core features enabled'); return; }
        try { await install.mutateAsync(slug); await activate.mutateAsync(slug); toast.success('Plugin installed and activated'); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to install plugin'); }
    };

    const handleActivate = async (slug: string) => {
        if (slug === STUB_PLUGIN.slug) { setStubEnabled(true); toast.success('Core features enabled'); return; }
        try { await activate.mutateAsync(slug); toast.success('Plugin activated'); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to activate plugin'); }
    };

    return { plugins, install, activate, stubEnabled, handleInstallAndActivate, handleActivate };
}

function buildPluginList(realPlugins: PluginInfoDto[], stubEnabled: boolean) {
    if (realPlugins.length > 0) return realPlugins;
    return [{ ...STUB_PLUGIN, status: stubEnabled ? 'active' as const : 'not_installed' as const, installedAt: stubEnabled ? new Date().toISOString() : null }];
}

/**
 * Step 3: Plugins (ROK-204)
 */
function PluginStepNavigation({ onBack, onSkip, onNext }: { onBack: () => void; onSkip: () => void; onNext: () => void }) {
    return (
        <div className="flex items-center justify-between pt-4 border-t border-edge/30">
            <div className="flex items-center gap-3">
                <button onClick={onBack} className="px-5 py-2.5 min-h-[44px] bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm">Back</button>
                <button onClick={onSkip} className="text-sm text-muted hover:text-foreground transition-colors px-4 py-2.5 min-h-[44px] rounded-lg hover:bg-edge/20">Skip</button>
            </div>
            <button onClick={onNext} className="px-6 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm">Next</button>
        </div>
    );
}

/**
 * Step 3: Plugins (ROK-204)
 */
export function ConnectPluginsStep({ onNext, onBack, onSkip }: ConnectPluginsStepProps) {
    const h = usePluginHandlers();
    const isPending = h.install.isPending || h.activate.isPending;

    if (h.plugins.isLoading) return <PluginsLoadingState />;
    if (h.plugins.isError) return <PluginsErrorState onBack={onBack} onSkip={onSkip} />;

    const pluginList = buildPluginList(h.plugins.data ?? [], h.stubEnabled);

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Install Plugins</h2>
                <p className="text-sm text-muted mt-1">Browse available plugins and install the ones your community needs. No plugins are enabled by default -- choose only what you want.</p>
            </div>
            <div className="space-y-3">
                {pluginList.map((plugin) => (
                    <PluginCard key={plugin.slug} plugin={plugin} isPending={isPending} onInstall={h.handleInstallAndActivate} onActivate={h.handleActivate} />
                ))}
            </div>
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                <p className="text-sm text-blue-400/80">
                    Plugins and integrations can be managed anytime in <span className="font-medium">Admin Settings &gt; Plugins</span>.
                    You can also configure API credentials under <span className="font-medium">Admin Settings &gt; Integrations</span>.
                </p>
            </div>
            <PluginStepNavigation onBack={onBack} onSkip={onSkip} onNext={onNext} />
        </div>
    );
}

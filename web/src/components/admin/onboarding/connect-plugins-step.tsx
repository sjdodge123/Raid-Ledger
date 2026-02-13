import { usePluginAdmin } from '../../../hooks/use-plugin-admin';
import { toast } from '../../../lib/toast';
import type { PluginInfoDto } from '@raid-ledger/contract';

interface ConnectPluginsStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Step 3: Plugins (ROK-204)
 * Shows available plugins with Install/Configure actions.
 * Plugins are NOT enabled by default -- the admin picks which ones to install.
 */
export function ConnectPluginsStep({
  onNext,
  onBack,
  onSkip,
}: ConnectPluginsStepProps) {
  const { plugins, install, activate } = usePluginAdmin();

  const handleInstallAndActivate = async (slug: string) => {
    try {
      await install.mutateAsync(slug);
      await activate.mutateAsync(slug);
      toast.success('Plugin installed and activated');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to install plugin',
      );
    }
  };

  const handleActivate = async (slug: string) => {
    try {
      await activate.mutateAsync(slug);
      toast.success('Plugin activated');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to activate plugin',
      );
    }
  };

  const isPending = install.isPending || activate.isPending;

  if (plugins.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Install Plugins
          </h2>
          <p className="text-sm text-muted mt-1">
            Loading available plugins...
          </p>
        </div>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 bg-panel/50 rounded-lg border border-edge/30"
            />
          ))}
        </div>
      </div>
    );
  }

  if (plugins.isError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Install Plugins
          </h2>
          <p className="text-sm text-red-400 mt-1">
            Failed to load plugins. You can configure them later in Admin
            Settings.
          </p>
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-edge/30">
          <button
            onClick={onBack}
            className="px-5 py-2.5 bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm"
          >
            Back
          </button>
          <button
            onClick={onSkip}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  const pluginList = plugins.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Install Plugins
        </h2>
        <p className="text-sm text-muted mt-1">
          Browse available plugins and install the ones your community needs.
          No plugins are enabled by default -- choose only what you want.
        </p>
      </div>

      {/* Plugin List */}
      {pluginList.length === 0 ? (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
          <p className="text-muted text-sm">
            No plugins available yet. You can check for new plugins in Admin
            Settings later.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pluginList.map((plugin) => (
            <PluginCard
              key={plugin.slug}
              plugin={plugin}
              isPending={isPending}
              onInstall={handleInstallAndActivate}
              onActivate={handleActivate}
            />
          ))}
        </div>
      )}

      {/* Info hint */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
        <p className="text-sm text-blue-400/80">
          Plugins and integrations can be managed anytime in{' '}
          <span className="font-medium">Admin Settings &gt; Plugins</span>.
          You can also configure API credentials under{' '}
          <span className="font-medium">Admin Settings &gt; Integrations</span>
          .
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-edge/30">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-5 py-2.5 bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm"
          >
            Back
          </button>
          <button
            onClick={onSkip}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Skip
          </button>
        </div>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// --- Plugin Card ---

function PluginCard({
  plugin,
  isPending,
  onInstall,
  onActivate,
}: {
  plugin: PluginInfoDto;
  isPending: boolean;
  onInstall: (slug: string) => void;
  onActivate: (slug: string) => void;
}) {
  const statusConfig = {
    not_installed: {
      label: 'Not Installed',
      className: 'bg-surface/50 text-muted border border-edge/50',
    },
    inactive: {
      label: 'Installed (Inactive)',
      className: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
    },
    active: {
      label: 'Active',
      className:
        'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    },
  } as const;

  const status = statusConfig[plugin.status];

  return (
    <div className="bg-panel/50 rounded-xl border border-edge/50 p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">
              {plugin.name}
            </h3>
            <span className="text-xs text-dim">{plugin.version}</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${status.className}`}
            >
              {status.label}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">{plugin.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {plugin.status === 'not_installed' && (
            <button
              onClick={() => onInstall(plugin.slug)}
              disabled={isPending}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              Install
            </button>
          )}
          {plugin.status === 'inactive' && (
            <button
              onClick={() => onActivate(plugin.slug)}
              disabled={isPending}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              Activate
            </button>
          )}
          {plugin.status === 'active' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400">
              <svg
                className="w-3.5 h-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Ready
            </span>
          )}
        </div>
      </div>

      {/* Capabilities */}
      {plugin.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plugin.capabilities.map((cap) => (
            <span
              key={cap}
              className="px-2 py-0.5 text-[10px] rounded-full bg-overlay text-secondary"
            >
              {cap}
            </span>
          ))}
        </div>
      )}

      {/* Game Slugs */}
      {plugin.gameSlugs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plugin.gameSlugs.map((slug) => (
            <span
              key={slug}
              className="px-2 py-0.5 text-[10px] rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"
            >
              {slug}
            </span>
          ))}
        </div>
      )}

      {/* Integrations preview when active */}
      {plugin.integrations.length > 0 && plugin.status === 'active' && (
        <div className="border-t border-edge/30 pt-2 mt-2">
          <span className="text-[10px] font-medium text-dim uppercase tracking-wider">
            Integrations
          </span>
          <div className="mt-1 space-y-1">
            {plugin.integrations.map((integration) => (
              <div
                key={integration.key}
                className="flex items-center gap-2 text-xs"
              >
                {integration.icon && (
                  <span className="text-sm">{integration.icon}</span>
                )}
                <span className="text-secondary">{integration.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    integration.configured
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {integration.configured ? 'Configured' : 'Not Configured'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

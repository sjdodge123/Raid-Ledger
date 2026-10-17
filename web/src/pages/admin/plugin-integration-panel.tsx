import { useParams } from 'react-router-dom';
import { PluginSlot } from '../../plugins/index';
import { usePluginStore } from '../../stores/plugin-store';

function NoConfigFallback() {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
            <p className="text-muted text-sm">
                No configuration UI available for this integration.
                Ensure the plugin is active.
            </p>
        </div>
    );
}

/**
 * Integrations > Plugin Integration panel.
 * ROK-281 v2: Renders plugin-provided integration content inside the Integrations tab.
 * Route: /admin/settings/integrations/plugin/:pluginSlug/:integrationKey
 */
export function PluginIntegrationPanel() {
    const { pluginSlug, integrationKey } = useParams<{
        pluginSlug: string;
        integrationKey: string;
    }>();
    const isActive = usePluginStore((s) => (pluginSlug ? s.activeSlugs.has(pluginSlug) : false));

    if (!pluginSlug || !integrationKey) {
        return (
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
                <p className="text-muted text-sm">Integration not found.</p>
            </div>
        );
    }

    // Other active plugins also fill this slot and render null for a foreign
    // slug, so PluginSlot's own fallback never fires for an inactive plugin.
    if (!isActive) return <NoConfigFallback />;

    return (
        <div className="space-y-6">
            <PluginSlot
                name="admin-settings:plugin-content"
                context={{ pluginSlug, integrationKey }}
                fallback={<NoConfigFallback />}
            />
        </div>
    );
}

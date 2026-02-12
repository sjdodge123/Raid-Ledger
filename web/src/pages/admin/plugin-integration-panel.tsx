import { useParams } from 'react-router-dom';
import { PluginSlot } from '../../plugins';

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

    if (!pluginSlug || !integrationKey) {
        return (
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
                <p className="text-muted text-sm">Integration not found.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PluginSlot
                name="admin-settings:plugin-content"
                context={{ pluginSlug, integrationKey }}
                fallback={
                    <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 text-center">
                        <p className="text-muted text-sm">
                            No configuration UI available for this integration.
                            Ensure the plugin is active.
                        </p>
                    </div>
                }
            />
        </div>
    );
}

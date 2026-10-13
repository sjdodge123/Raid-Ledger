/**
 * Pelican admin panel (ROK-121), rendered in the `admin-settings:plugin-content`
 * slot. Renders nothing for any other plugin/integration, so its config query
 * only runs on its own panel.
 */
import { getPluginBadge } from '../../plugin-registry';
import { IntegrationCard } from '../../../components/admin/IntegrationCard';
import { usePelicanConfig } from '../hooks/use-pelican-config';
import { PelicanConnectionForm } from './pelican-connection-form';
import { PelicanSetupSteps } from './pelican-setup-steps';
import { isPelicanConfigured } from './pelican-form.helpers';

export const PELICAN_INTEGRATION_KEY = 'pelican-panel';

function PelicanPanel() {
    const { data: config, isLoading, isError } = usePelicanConfig();
    return (
        <IntegrationCard title="Pelican" description="Game-server panel connection" icon={null}
            pluginBadge={getPluginBadge('pelican')} isConfigured={config ? isPelicanConfigured(config) : false}
            isLoading={isLoading}>
            <section className="space-y-4" aria-labelledby="pelican-connection-title">
                <h3 id="pelican-connection-title" className="text-lg font-semibold text-foreground border-b border-edge pb-2">Connection</h3>
                {isError && <p role="alert" className="text-sm text-danger">Couldn&apos;t load the Pelican settings.</p>}
                {config && (
                    <>
                        <PelicanSetupSteps />
                        <PelicanConnectionForm config={config} />
                    </>
                )}
            </section>
        </IntegrationCard>
    );
}

export function PelicanPluginContent({ pluginSlug, integrationKey }: { pluginSlug?: string; integrationKey?: string }) {
    if (pluginSlug !== 'pelican') return null;
    if (integrationKey && integrationKey !== PELICAN_INTEGRATION_KEY) return null;
    return <PelicanPanel />;
}

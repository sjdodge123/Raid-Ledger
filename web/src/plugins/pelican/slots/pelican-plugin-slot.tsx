/**
 * Entry-chunk gate for the Pelican admin panel (ROK-121). register.ts loads
 * with the app shell, so it imports only this file; the panel, its form and
 * its config query live in a lazy chunk fetched the first time the Pelican
 * integration card renders — keeping the entry chunk inside its budget.
 */
import { Suspense } from 'react';
import { LoadingSpinner } from '../../../components/ui/loading-spinner';
import { lazyWithRetry } from '../../../lazy-routes';
import { isPelicanSlot } from './pelican-slot.helpers';

const PelicanPanel = lazyWithRetry(() =>
    import('./pelican-plugin-content').then((m) => ({ default: m.PelicanPanel })),
);

export function PelicanPluginSlot({ pluginSlug, integrationKey }: { pluginSlug?: string; integrationKey?: string }) {
    if (!isPelicanSlot(pluginSlug, integrationKey)) return null;
    return (
        <Suspense fallback={<LoadingSpinner />}>
            <PelicanPanel />
        </Suspense>
    );
}

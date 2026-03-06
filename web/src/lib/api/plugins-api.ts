import type { PluginInfoDto } from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch all plugins */
export async function getPlugins(): Promise<PluginInfoDto[]> {
    const response = await fetchApi<{ data: PluginInfoDto[] }>(
        '/admin/plugins',
    );
    return response.data;
}

/** Install a plugin */
export async function installPlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/install`, { method: 'POST' });
}

/** Uninstall a plugin */
export async function uninstallPlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/uninstall`, { method: 'POST' });
}

/** Activate a plugin */
export async function activatePlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/activate`, { method: 'POST' });
}

/** Deactivate a plugin */
export async function deactivatePlugin(slug: string): Promise<void> {
    await fetchApi(`/admin/plugins/${slug}/deactivate`, {
        method: 'POST',
    });
}

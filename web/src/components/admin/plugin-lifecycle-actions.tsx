/**
 * The Install / Activate / Deactivate / Uninstall buttons shared by the admin
 * plugins card and the onboarding plugin card (ROK-1969 verify step 2). Built on
 * the design-system `Button`: `primary` to turn a plugin on, `warning-soft` to
 * pause it, `destructive-soft` to remove it. `size="sm"` is 44px below `lg`
 * (the touch target) and 36px from `lg` up. A built-in plugin (Core) is always
 * on, so it gets no lifecycle actions.
 */
import type { JSX } from 'react';
import type { PluginInfoDto } from '@raid-ledger/contract';
import { Button } from '../ui/button';

export interface PluginLifecycleActionsProps {
    plugin: PluginInfoDto;
    isPending: boolean;
    onInstall: (slug: string) => void;
    onActivate: (slug: string) => void;
    onDeactivate: (slug: string) => void;
    onUninstall: (slug: string) => void;
}

/** The lifecycle buttons for one plugin's status; renders nothing for a built-in plugin. */
export function PluginLifecycleActions(props: PluginLifecycleActionsProps): JSX.Element | null {
    const { plugin, isPending, onInstall, onActivate, onDeactivate, onUninstall } = props;
    if (plugin.builtIn) return null;
    const { slug, status } = plugin;
    return (
        <>
            {status === 'not_installed' && (
                <Button size="sm" onClick={() => onInstall(slug)} disabled={isPending}>Install</Button>
            )}
            {status === 'active' && (
                <Button size="sm" variant="warning-soft" onClick={() => onDeactivate(slug)} disabled={isPending}>Deactivate</Button>
            )}
            {status === 'inactive' && (
                <>
                    <Button size="sm" onClick={() => onActivate(slug)} disabled={isPending}>Activate</Button>
                    <Button size="sm" variant="destructive-soft" onClick={() => onUninstall(slug)} disabled={isPending}>Uninstall</Button>
                </>
            )}
        </>
    );
}

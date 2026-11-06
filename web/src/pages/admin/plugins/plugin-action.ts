import { toast } from '../../../lib/toast';

/** A Manage Plugins card action that runs without a confirm step. */
export type PluginAction = 'install' | 'activate' | 'deactivate';

/** Past tense of each card action, for the success toast ("Plugin installed"). */
const ACTION_PAST_TENSE: Record<PluginAction, string> = {
    install: 'installed',
    activate: 'activated',
    deactivate: 'deactivated',
};

/** Run one plugin card action and toast its outcome (uninstall has its own confirm flow). */
export async function executePluginMutation(mutations: Record<PluginAction, { mutateAsync: (s: string) => Promise<void> }>, action: PluginAction, slug: string): Promise<void> {
    const mutation = mutations[action];
    try {
        await mutation.mutateAsync(slug);
        toast.success(`Plugin ${ACTION_PAST_TENSE[action]}`);
    } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${action} plugin`);
    }
}

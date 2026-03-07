import type { JSX } from 'react';
import { Modal } from '../../components/ui/modal';
import type { PluginInfoDto } from '@raid-ledger/contract';

/** Uninstall confirmation modal for plugins */
export function UninstallConfirmModal({ plugin, onClose, onConfirm, isPending }: {
    plugin: PluginInfoDto | null;
    onClose: () => void;
    onConfirm: () => void;
    isPending: boolean;
}): JSX.Element {
    const configuredIntegrations = plugin?.integrations.filter((i) => i.configured) ?? [];

    return (
        <Modal isOpen={!!plugin} onClose={onClose} title="Uninstall Plugin">
            <div className="space-y-4">
                <p className="text-secondary">
                    Are you sure you want to uninstall{' '}
                    <strong className="text-foreground">{plugin?.name}</strong>?
                </p>

                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-sm text-red-400 font-medium mb-1">
                        This action will permanently delete:
                    </p>
                    <ul className="text-sm text-red-400/80 list-disc list-inside space-y-0.5">
                        <li>All plugin settings and saved configuration</li>
                        <li>Integration credentials stored for this plugin</li>
                    </ul>
                </div>

                {configuredIntegrations.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                        <p className="text-sm text-amber-400 font-medium mb-1">
                            Configured integrations that will lose credentials:
                        </p>
                        <ul className="text-sm text-amber-400/80 list-disc list-inside space-y-0.5">
                            {configuredIntegrations.map((i) => (<li key={i.key}>{i.name}</li>))}
                        </ul>
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors">Cancel</button>
                    <button onClick={onConfirm} disabled={isPending}
                        className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-foreground font-medium rounded-lg transition-colors">
                        {isPending ? 'Uninstalling...' : 'Uninstall'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

/**
 * Pelican admin — Servers section (ROK-1094), below Connection once the
 * connection is configured. Sync now (ROK-1772) + the editable servers list.
 */
import type { PelicanSyncResult } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { toast } from '../../../lib/toast';
import { usePelicanServers, usePelicanSyncNow, useUpdatePelicanServer } from '../hooks/use-pelican-servers';
import { PelicanServersTable } from './pelican-servers-table';
import { errorMessage, syncToast } from './pelican-servers.helpers';
import type { ServerUpdateHandler } from './pelican-server-row';

const LEGEND = 'Status: green running, amber starting or stopping, red offline or suspended, grey not checked recently. '
    + 'Only servers with a game and Show on calendar on get status checks.';

function showSyncToast(result: PelicanSyncResult): void {
    const t = syncToast(result);
    if (t.tone === 'success') toast.success(t.text);
    else if (t.tone === 'info') toast.info(t.text);
    else toast.error(t.text);
}

function ServersBody({ defaultTimezone, onUpdate }: { defaultTimezone: string; onUpdate: ServerUpdateHandler }) {
    const { data: rows, isLoading, isError } = usePelicanServers();
    if (isError) return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the Pelican servers.</p>;
    if (isLoading || !rows) return null;
    if (rows.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted text-sm">No servers yet. Save the connection, then Sync now.</p>
            </div>
        );
    }
    return <PelicanServersTable rows={rows} defaultTimezone={defaultTimezone} onUpdate={onUpdate} />;
}

export function PelicanServersSection({ defaultTimezone }: { defaultTimezone: string }) {
    const sync = usePelicanSyncNow();
    const update = useUpdatePelicanServer();
    const onSync = () => sync.mutate(undefined, {
        onSuccess: showSyncToast,
        onError: (err) => toast.error(errorMessage(err, 'Failed to sync Pelican servers')),
    });
    // The failure toast lives in the hook's onError, so every failing edit toasts.
    const onUpdate: ServerUpdateHandler = (id, patch, gameName) => update.mutate({ id, patch, gameName });
    return (
        <section className="space-y-4 pt-6" aria-labelledby="pelican-servers-title">
            <h3 id="pelican-servers-title" className="text-lg font-semibold text-foreground border-b border-edge pb-2">Servers</h3>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-muted max-w-prose">{LEGEND}</p>
                <Button variant="secondary" size="sm" loading={sync.isPending} loadingLabel="Syncing…" onClick={onSync}>
                    Sync now
                </Button>
            </div>
            <ServersBody defaultTimezone={defaultTimezone} onUpdate={onUpdate} />
        </section>
    );
}

/**
 * Mod-link token control on a Pelican admin server row (ROK-1833), filled into
 * the `pelican-server:row-extras` slot. Site admins only (the list route is
 * admin-guarded; a refusal renders nothing). A row not mapped to Valheim gets
 * a disabled Generate with a tooltip.
 */
import { useEffect, useRef, type JSX } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import type { ValheimLinkTokenStatus } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import { useValheimLinkTokens, VALHEIM_LINK_TOKENS_KEY } from '../hooks/use-valheim-link-tokens';
import { useValheimTokenActions, type TokenActions } from './use-valheim-token-actions';
import { ValheimLinkTokenConfirm } from './valheim-link-token-confirm';
import { ValheimLinkTokenDialog } from './valheim-link-token-dialog';

export interface ValheimLinkTokenControlProps {
    serverId: number;
    gameId: number | null;
    serverName: string;
    inline?: boolean;
}

/** Re-read the list when this row's game changes — the mapping decides which rows it lists. */
function useRefreshOnRemap(gameId: number | null): void {
    const qc = useQueryClient();
    const last = useRef(gameId);
    useEffect(() => {
        if (last.current === gameId) return;
        last.current = gameId;
        void qc.invalidateQueries({ queryKey: [...VALHEIM_LINK_TOKENS_KEY] });
    }, [gameId, qc]);
}

/** See file docstring. */
export function ValheimLinkTokenControl({ serverId, gameId, serverName, inline = false }: ValheimLinkTokenControlProps): JSX.Element | null {
    const list = useValheimLinkTokens();
    useRefreshOnRemap(gameId);
    if (!list.isSuccess) return null;
    const status = list.data.find((s) => s.pelicanServerId === serverId);
    return (
        <div data-testid={`valheim-link-token-${serverId}`}
            className={inline ? 'flex flex-col items-start gap-2' : 'flex items-start justify-between gap-3'}>
            {!inline && <span className="text-sm text-secondary">Mod link</span>}
            {status ? <MappedControl status={status} serverName={serverName} inline={inline} />
                : <UnmappedControl serverId={serverId} />}
        </div>
    );
}

function UnmappedControl({ serverId }: { serverId: number }): JSX.Element {
    return (
        <span title="Map this server to Valheim to link the mod" data-testid={`valheim-link-token-${serverId}-unmapped`}>
            <Button variant="secondary" size="sm" disabled>Generate token</Button>
        </span>
    );
}

function MappedControl({ status, serverName, inline }: { status: ValheimLinkTokenStatus; serverName: string; inline: boolean }): JSX.Element {
    const actions = useValheimTokenActions(status.pelicanServerId);
    return (
        <div className={`flex flex-col gap-2 ${inline ? 'items-start' : 'items-end text-right'}`}>
            <TokenStatusLine status={status} />
            <TokenButtons status={status} actions={actions} />
            {actions.error !== null && (
                <p role="alert" className="p-2 rounded-lg border bg-danger/10 border-danger/30 text-xs text-danger">{actions.error}</p>
            )}
            {actions.confirm !== null && (
                <ValheimLinkTokenConfirm kind={actions.confirm} serverName={serverName} isPending={actions.isPending}
                    onConfirm={actions.runConfirm} onClose={actions.closeConfirm} />
            )}
            {actions.issued !== null && (
                <ValheimLinkTokenDialog issued={actions.issued} serverName={serverName} onClose={actions.closeDialog} />
            )}
        </div>
    );
}

function TokenStatusLine({ status }: { status: ValheimLinkTokenStatus }): JSX.Element {
    if (status.state === 'none') return <span className="text-sm text-muted">Not connected</span>;
    if (status.state === 'revoked') return <StatusChip tone="neutral" title="Mod token revoked">Revoked</StatusChip>;
    const since = status.rotatedAt ?? status.createdAt;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone="success" title="Mod token active">…{status.tokenHint}</StatusChip>
            {since !== null && <span className="text-xs text-muted">Active since {format(new Date(since), 'PP')}</span>}
        </div>
    );
}

function TokenButtons({ status, actions }: { status: ValheimLinkTokenStatus; actions: TokenActions }): JSX.Element {
    const id = status.pelicanServerId;
    if (status.state !== 'active') {
        return (
            <Button variant="secondary" size="sm" onClick={actions.generate} loading={actions.isPending}
                loadingLabel="Generating…" data-testid={`valheim-link-token-${id}-generate`}>Generate token</Button>
        );
    }
    return (
        <div className="flex flex-wrap gap-2">
            <Button variant="warning-soft" size="sm" onClick={() => actions.ask('rotate')} data-testid={`valheim-link-token-${id}-rotate`}>Rotate</Button>
            <Button variant="destructive-soft" size="sm" onClick={() => actions.ask('revoke')} data-testid={`valheim-link-token-${id}-revoke`}>Revoke</Button>
        </div>
    );
}

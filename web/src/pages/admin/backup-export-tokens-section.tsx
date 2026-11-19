/**
 * ROK-2263 — Admin → Backups "Clone access tokens": list, mint (shown once)
 * and revoke the `rlbx_` tokens a clone script uses to download backups.
 * Rows stack below 1024px (design-system §4.18) and lay out in one line above.
 */
import { useState, type JSX } from 'react';
import {
    BACKUP_EXPORT_TOKEN_LIVE_CAP,
    type BackupExportToken,
    type MintBackupExportTokenResponse,
} from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { StatusChip, type StatusChipTone } from '../../components/ui/status-chip';
import { useTimezoneStore } from '../../stores/timezone-store';
import {
    backupExportTokenStatus,
    useBackupExportTokens,
    type BackupExportTokenStatus,
} from '../../hooks/use-backup-export-tokens';
import { formatDate } from './backup-panel-utils';
import { MintTokenModal, MintedTokenDialog, RevokeTokenModal } from './backup-export-token-dialogs';

const CAP_HINT_ID = 'backup-export-token-cap-hint';

const STATUS_CHIP: Record<BackupExportTokenStatus, { tone: StatusChipTone; title: string }> = {
    live: { tone: 'success', title: 'This token works' },
    expired: { tone: 'warning', title: 'This token has expired' },
    revoked: { tone: 'neutral', title: 'This token was revoked' },
};

function SectionHeader({ onNew, capReached }: { onNew: () => void; capReached: boolean }): JSX.Element {
    return (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <h3 className="text-base font-semibold text-foreground">Clone access tokens</h3>
                <p className="text-sm text-muted mt-1">Lets a script download backups from this server. It cannot restore, delete or reset.</p>
            </div>
            <div className="flex flex-col gap-1 lg:items-end">
                <Button variant="secondary" className="whitespace-nowrap" onClick={onNew} disabled={capReached}
                    aria-describedby={capReached ? CAP_HINT_ID : undefined} data-testid="backup-export-token-new">
                    New token
                </Button>
                {capReached && (
                    <p id={CAP_HINT_ID} className="text-xs text-muted lg:text-right" data-testid="backup-export-token-cap-hint">
                        {BACKUP_EXPORT_TOKEN_LIVE_CAP} live tokens is the limit. Revoke one to make another.
                    </p>
                )}
            </div>
        </div>
    );
}

function TokenMeta({ token, tz }: { token: BackupExportToken; tz: string }): JSX.Element {
    const creator = token.createdBy?.username ?? 'a removed user';
    return (
        <div className="text-xs text-muted flex flex-col gap-0.5 lg:flex-row lg:flex-wrap lg:gap-x-4">
            <span>Created by {creator} · {formatDate(token.createdAt, tz)}</span>
            <span>Last used: {token.lastUsedAt ? formatDate(token.lastUsedAt, tz) : 'Never'}</span>
            <span>{token.expiresAt ? `Expires: ${formatDate(token.expiresAt, tz)}` : 'Never expires'}</span>
        </div>
    );
}

function TokenRow({ token, tz, onRevoke }: { token: BackupExportToken; tz: string; onRevoke: (t: BackupExportToken) => void }): JSX.Element {
    const status = backupExportTokenStatus(token);
    const chip = STATUS_CHIP[status];
    return (
        <li className="px-4 py-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4" data-testid="backup-export-token-row" data-status={status}>
            <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm text-foreground">
                    <span className="font-medium break-words">{token.label}</span>{' '}
                    <span className="font-mono text-muted">…{token.tokenHint}</span>
                </p>
                <TokenMeta token={token} tz={tz} />
            </div>
            <div className="flex items-center gap-3 lg:shrink-0">
                <StatusChip tone={chip.tone} title={chip.title}>{status}</StatusChip>
                {status === 'live' && (
                    <Button variant="destructive-soft" size="sm" onClick={() => onRevoke(token)} data-testid="backup-export-token-revoke">
                        Revoke
                    </Button>
                )}
            </div>
        </li>
    );
}

function TokenList({ tz, onRevoke }: { tz: string; onRevoke: (t: BackupExportToken) => void }): JSX.Element {
    const query = useBackupExportTokens();
    if (query.isLoading) return <p className="py-6 text-center text-sm text-muted">Loading tokens...</p>;
    if (query.isError) {
        return <p className="py-6 text-center text-sm text-danger" data-testid="backup-export-token-error">Failed to load clone access tokens.</p>;
    }
    const tokens = query.data?.tokens ?? [];
    if (tokens.length === 0) {
        return <p className="py-6 text-center text-sm text-muted" data-testid="backup-export-token-empty">No clone access tokens yet.</p>;
    }
    return (
        <ul className="border border-edge rounded-xl divide-y divide-edge" data-testid="backup-export-token-list">
            {tokens.map((t) => <TokenRow key={t.id} token={t} tz={tz} onRevoke={onRevoke} />)}
        </ul>
    );
}

function useLiveCount(): number {
    const tokens = useBackupExportTokens().data?.tokens ?? [];
    return tokens.filter((t) => backupExportTokenStatus(t) === 'live').length;
}

/** The section between the backups table and the Danger Zone. */
export function BackupExportTokensSection(): JSX.Element {
    const tz = useTimezoneStore((s) => s.resolved);
    const [mintOpen, setMintOpen] = useState(false);
    const [minted, setMinted] = useState<MintBackupExportTokenResponse | null>(null);
    const [revokeTarget, setRevokeTarget] = useState<BackupExportToken | null>(null);
    const capReached = useLiveCount() >= BACKUP_EXPORT_TOKEN_LIVE_CAP;
    const onMinted = (res: MintBackupExportTokenResponse): void => { setMintOpen(false); setMinted(res); };
    return (
        <section className="space-y-4" data-testid="backup-export-tokens-section" aria-label="Clone access tokens">
            <SectionHeader onNew={() => setMintOpen(true)} capReached={capReached} />
            <TokenList tz={tz} onRevoke={setRevokeTarget} />
            {mintOpen && <MintTokenModal onClose={() => setMintOpen(false)} onMinted={onMinted} />}
            {minted && <MintedTokenDialog minted={minted} onClose={() => setMinted(null)} />}
            {revokeTarget && <RevokeTokenModal token={revokeTarget} onClose={() => setRevokeTarget(null)} />}
        </section>
    );
}

/**
 * ROK-1830 S4 — "Page editors", moved out of the WoW Overview widget into core
 * (D8-B: delegation is core, not a game's business). Core owns the list, the
 * removable chips and the always-can-edit line; the pickers that ADD a grant
 * are the only game-shaped part (WoW offers whole ranks), so a hub module
 * contributes them through `HubModule.editorDelegation`. Endpoints are
 * unchanged: GET/POST/DELETE `/guilds/:id/editors`.
 */
import type { JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { GuildEditor } from '@raid-ledger/contract';
import type { HubCtx, HubModule } from '../../../plugins/hub-module';
import { Button } from '../../ui/button';
import { RoleBadge } from '../../ui/role-badge';
import { useAddGuildEditor, useGuildEditors, useRemoveGuildEditor } from '../api/use-guild';
import { hubCopy } from '../hub-copy';

function AlwaysEditors(): JSX.Element {
    return (
        <ul className="flex flex-col gap-1 text-sm text-secondary">
            <li className="flex items-center gap-2">Raid Ledger admins <RoleBadge role="admin" /></li>
            <li className="flex items-center gap-2">Raid Ledger operators <RoleBadge role="operator" /></li>
        </ul>
    );
}

function editorLabel(e: GuildEditor): string {
    if (e.kind === 'rank') return `Rank: ${e.rankName ?? `Rank ${e.rankIndex ?? '?'}`}`;
    return e.memberName ?? 'Unknown member';
}

function EditorChip({ editor, disabled, onRemove }: { editor: GuildEditor; disabled: boolean; onRemove: () => void }): JSX.Element {
    const label = editorLabel(editor);
    return (
        <li data-testid="guild-editor-chip"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-success/30 bg-success/10 pl-3 text-sm font-medium text-success">
            {label}
            <Button variant="ghost" iconOnly aria-label={`Remove ${label}`} onClick={onRemove} disabled={disabled}>
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </li>
    );
}

/** Rendered inside the settings sheet, which is Leader/admin only (`canManageEditors`). */
export function HubEditorsSection({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    const { page } = ctx;
    const guildId = page.guild.id;
    const editors = useGuildEditors(guildId, true);
    const add = useAddGuildEditor(guildId);
    const remove = useRemoveGuildEditor(guildId);
    const list = editors.data?.editors ?? [];
    const pending = add.isPending || remove.isPending;
    const error = editors.error ?? add.error ?? remove.error;
    const Delegation = mod?.editorDelegation;
    return (
        <div className="flex flex-col gap-3" data-testid="guild-editors-panel">
            <AlwaysEditors />
            <ul aria-label="Page editors" className="flex flex-wrap gap-2">
                {list.map((e) => <EditorChip key={e.id} editor={e} disabled={pending} onRemove={() => remove.mutate(e.id)} />)}
            </ul>
            {editors.isSuccess && list.length === 0 && (
                <p className="text-sm text-muted">{hubCopy(page.guild.kind).editorsEmpty}</p>
            )}
            {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error.message}</p>}
            {Delegation
                ? <Delegation page={page} editors={list} pending={pending} onAdd={(input) => add.mutate(input)} />
                : <p className="text-sm text-muted" data-testid="guild-editors-no-delegation">This hub offers no delegation options yet.</p>}
        </div>
    );
}

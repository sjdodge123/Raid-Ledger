/**
 * ROK-2136 — the "Guild message" card body: Message of the Day then Guild
 * Information, each as plain text (never Markdown) with preserved line breaks,
 * a "Copy for in-game" `CopyButton` that copies the stored text verbatim, and
 * an "Updated … by …" line. Members see only the set fields; editors see "Not
 * set" for an empty one, and the quiet "Add guild text" hint when both are
 * empty. Default export so the registration can `React.lazy` it.
 */
import { Suspense, lazy, type JSX } from 'react';
import type { GuildIngameTextField, IngameTextFieldKey } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { CopyButton } from '../../../components/ui/CopyButton';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useGuildIngameText } from '../hooks/use-guild-ingame-text';
import { useGuildTextDialog } from './guild-text-dialog-store';
import { FIELD_LABELS, updatedLine } from './guild-text.helpers';

const LazyGuildTextDialog = lazy(() => import('./guild-text-dialog'));

export const GUILD_TEXT_EMPTY_HINT = 'Add the guild Message of the Day and Guild Information';
export const COPY_LABEL = 'Copy for in-game';
export const NOT_SET_COPY = 'Not set';

interface BlockProps { field: IngameTextFieldKey; value: GuildIngameTextField | null; canEdit: boolean }

function TextBlock({ field, value, canEdit }: BlockProps): JSX.Element | null {
    if (value === null && !canEdit) return null;
    return (
        <div data-testid={`guild-text-${field}`} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">{FIELD_LABELS[field]}</p>
                {value !== null && <CopyButton text={value.text} label={COPY_LABEL} />}
            </div>
            {value === null ? (
                <p className="text-sm text-muted">{NOT_SET_COPY}</p>
            ) : (
                <>
                    <p data-testid={`guild-text-${field}-text`} className="text-sm text-foreground whitespace-pre-wrap break-words">
                        {value.text}
                    </p>
                    <p data-testid={`guild-text-${field}-updated`} className="text-xs text-dim">{updatedLine(value)}</p>
                </>
            )}
        </div>
    );
}

function EditorHint({ guildId }: { guildId: number }): JSX.Element {
    const open = useGuildTextDialog((s) => s.open);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="guild-text-hint">
            <p className="text-sm text-muted">{GUILD_TEXT_EMPTY_HINT}</p>
            <Button variant="secondary" size="sm" data-testid="guild-text-add" onClick={() => open(guildId)}>Add guild text</Button>
        </div>
    );
}

/** The editor dialog, lazy-loaded, while the store says this hub's editor is open. */
function DialogMount({ guildId }: { guildId: number }): JSX.Element | null {
    const openFor = useGuildTextDialog((s) => s.guildId);
    const close = useGuildTextDialog((s) => s.close);
    if (openFor !== guildId) return null;
    return <Suspense fallback={null}><LazyGuildTextDialog guildId={guildId} onClose={close} /></Suspense>;
}

export default function GuildTextWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useGuildIngameText(guildId);
    if (data === undefined) return null;
    const { motd, info, viewer } = data;
    const dialog = viewer.canEdit ? <DialogMount guildId={guildId} /> : null;
    if (motd === null && info === null) return viewer.canEdit ? <><EditorHint guildId={guildId} />{dialog}</> : null;
    return (
        <div className="flex flex-col gap-4" data-testid="guild-text-card">
            {dialog}
            <TextBlock field="motd" value={motd} canEdit={viewer.canEdit} />
            <TextBlock field="info" value={info} canEdit={viewer.canEdit} />
        </div>
    );
}

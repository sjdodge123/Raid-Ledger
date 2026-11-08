/**
 * ROK-2137 — the editor-only "Changed in game" notice inside one field of the
 * Forever "Guild message" card: the text the game last reported (clamped,
 * expandable when long) with **Use in-game text** (Adopt) and **Keep hub
 * text** (Push). Both store the returned DTO in the card's query, so the card
 * updates without a refetch. After a Push the notice gives way to a one-line
 * hint: the officer's next step is the field's existing "Copy for in-game".
 * Reuses the §4.7 `DialogBanner` (`warning` tint) — token colours only.
 */
import { useState, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GuildIngameGameReport, IngameTextFieldKey } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { DialogBanner } from '../../../components/ui/dialog-banner';
import { toast } from '../../../lib/toast';
import { syncedAgo } from '../../../lib/synced-ago';
import type { GuildGameTextAction } from '../api-client';
import { guildIngameTextKey, useGuildIngameGameAction } from '../hooks/use-guild-ingame-text';
import { GAME_NOTICE_COPY, conflictTextOf } from './guild-text.helpers';

const CLAMP_CHARS = 140;
const CLAMP_LINES = 3;

/** Long enough to clamp: over ~3 lines of prose or more than 3 line breaks' worth. */
function isLong(text: string): boolean {
    return text.length > CLAMP_CHARS || text.split('\n').length > CLAMP_LINES;
}

function GameText({ field, text }: { field: IngameTextFieldKey; text: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    const long = isLong(text);
    const clamp = long && !open ? ' line-clamp-3' : '';
    return (
        <>
            <p data-testid={`guild-text-${field}-game-text`} className={`whitespace-pre-wrap break-words text-foreground${clamp}`}>
                {text === '' ? GAME_NOTICE_COPY.empty : text}
            </p>
            {long && (
                <Button variant="ghost" size="sm" className="self-start" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                    {open ? GAME_NOTICE_COPY.showLess : GAME_NOTICE_COPY.showAll}
                </Button>
            )}
        </>
    );
}

/** The mutation plus its error handling: a toast, and a 409 carrying fresher text refreshes the card. */
function useGameAction(guildId: number, field: IngameTextFieldKey, onKept: () => void) {
    const client = useQueryClient();
    const mutation = useGuildIngameGameAction(guildId, field);
    const run = (action: GuildGameTextAction): void => {
        mutation.mutate(action, {
            onSuccess: () => { if (action === 'push') onKept(); },
            onError: (error) => {
                const fresh = conflictTextOf(error);
                if (fresh !== null) client.setQueryData(guildIngameTextKey(guildId), fresh);
                toast.error(action === 'adopt' ? GAME_NOTICE_COPY.adoptError : GAME_NOTICE_COPY.keepError);
            },
        });
    };
    return { run, pending: mutation.isPending, action: mutation.variables };
}

interface NoticeProps { field: IngameTextFieldKey; report: GuildIngameGameReport; act: ReturnType<typeof useGameAction> }

function Notice({ field, report, act: { run, pending, action } }: NoticeProps): JSX.Element {
    return (
        <DialogBanner tone="warning" testId={`guild-text-${field}-game`}>
            <div className="flex min-w-0 basis-full flex-col gap-1">
                <p className="text-xs font-medium">{`${GAME_NOTICE_COPY.heading} · ${syncedAgo(report.gameReportedAt)}`}</p>
                <GameText field={field} text={report.gameText} />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="warning-soft" size="sm" data-testid={`guild-text-${field}-adopt`}
                    disabled={pending} loading={pending && action === 'adopt'} onClick={() => run('adopt')}>
                    {GAME_NOTICE_COPY.adopt}
                </Button>
                <Button variant="secondary" size="sm" data-testid={`guild-text-${field}-keep`}
                    disabled={pending} loading={pending && action === 'push'} onClick={() => run('push')}>
                    {GAME_NOTICE_COPY.keep}
                </Button>
            </div>
        </DialogBanner>
    );
}

interface ChangeProps { guildId: number; field: IngameTextFieldKey; report: GuildIngameGameReport | null | undefined }

/**
 * Editors only (the server sends `game` to editors alone): the notice, the
 * post-Push hint, or nothing. Owns the mutation, so its callbacks still run
 * after a success unmounts the notice.
 */
export function GameTextChange({ guildId, field, report }: ChangeProps): JSX.Element | null {
    const [kept, setKept] = useState(false);
    const act = useGameAction(guildId, field, () => setKept(true));
    if (report?.changedInGame === true) return <Notice field={field} report={report} act={act} />;
    if (!kept) return null;
    return <p data-testid={`guild-text-${field}-kept`} className="text-xs text-muted">{GAME_NOTICE_COPY.keptHint}</p>;
}

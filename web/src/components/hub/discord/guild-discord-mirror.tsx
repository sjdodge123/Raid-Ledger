/**
 * ROK-1788 (S4 of ROK-1781) — the read-only Discord channel mirror on the
 * guild Overview (approved prototype `DiscordMirror.tsx`, `compact`, span 2).
 * Every state renders inside the card (D9): unset (editors only), Discord
 * disconnected, access lost, channel deleted, and the latest 3 messages.
 * Messages reuse the ROK-1483 `ThreadMessageRow`; the embed block rides in
 * its `children` slot.
 *
 * ROK-1830 S4: the card no longer OWNS the picker — it is mounted by the hub
 * frame behind the settings sheet (Leader + admin, D10/Q4). The card keeps the
 * in-context shortcut and only renders it when `onChangeChannel` is given, so
 * an Officer (who can still edit content) sees none.
 */
import { useId, useMemo, useState, type JSX, type ReactNode } from 'react';
import type {
    GuildDiscordEmbedDto, GuildDiscordMessageDto, GuildDiscordMirrorDto, GuildKind, ThreadMessageMentionDto,
} from '@raid-ledger/contract';
import { ThreadMessageRow } from '../../discord/ThreadMessageRow';
import { DiscordMarkup } from '../../discord/DiscordMarkup';
import type { DiscordChannelName } from '../../discord/discord-markup.parse';
import { Button } from '../../ui/button';
import { Card, SectionTitle } from '../hub-bits';
import { canExpandMessages, isMirrorBound, mirrorBlurb, mirrorTitle, visibleMessages } from './guild-discord.helpers';
import { MirrorError, MirrorFooter, MirrorHeaderAction, ShowMoreToggle } from './guild-discord-mirror.parts';
import { useGuildDiscordMirror } from './use-guild-discord';
import { httpStatusOf } from '../../../lib/api/api-error';

type OkMirror = Extract<GuildDiscordMirrorDto, { state: 'ok' }>;

/** ROK-1878: every Discord text field renders through `DiscordMarkup`, never raw. */
interface MarkupCtx { mentions: ThreadMessageMentionDto[]; channels: DiscordChannelName[] }

function EmbedBlock({ embed, ctx }: { embed: GuildDiscordEmbedDto; ctx: MarkupCtx }): JSX.Element {
    return (
        <div data-testid="guild-discord-embed" className="mt-2 rounded-md border border-edge border-l-4 border-l-success bg-panel px-3 py-2">
            {embed.title && <p className="break-words text-sm font-semibold text-foreground"><DiscordMarkup text={embed.title} {...ctx} /></p>}
            {embed.description && <p className="whitespace-pre-line break-words text-xs text-muted"><DiscordMarkup text={embed.description} {...ctx} /></p>}
        </div>
    );
}

function MessageItem({ message, channels }: { message: GuildDiscordMessageDto; channels: DiscordChannelName[] }): JSX.Element {
    const ctx: MarkupCtx = { mentions: message.mentions, channels };
    const body = (
        <div data-testid="discord-text" className="whitespace-pre-wrap break-words text-sm text-foreground">
            <DiscordMarkup text={message.content} {...ctx} />
        </div>
    );
    return (
        <ThreadMessageRow message={message} body={body}>
            {message.embed && <EmbedBlock embed={message.embed} ctx={ctx} />}
        </ThreadMessageRow>
    );
}

interface ListProps { messages: GuildDiscordMessageDto[]; channel: OkMirror['channel']; id: string }

function MessageList({ messages, channel, id }: ListProps): JSX.Element {
    const channels = useMemo((): DiscordChannelName[] => [{ id: channel.id, name: channel.name }], [channel.id, channel.name]);
    return (
        <ul id={id} aria-label={`Latest messages in #${channel.name}`} className="flex flex-col gap-2" data-testid="guild-discord-messages">
            {messages.map((m) => <MessageItem key={m.messageId} message={m} channels={channels} />)}
        </ul>
    );
}

/** ROK-2185: newest 3 by default; Show more expands in-card to every fetched message (≤10). */
function OkBody({ mirror }: { mirror: OkMirror }): JSX.Element {
    const [expanded, setExpanded] = useState(false);
    const listId = useId();
    const shown = visibleMessages(mirror.messages, expanded);
    return (
        <>
            {shown.length > 0
                ? <MessageList messages={shown} channel={mirror.channel} id={listId} />
                : <p className="py-6 text-center text-sm text-muted" data-testid="guild-discord-state-empty">No messages in #{mirror.channel.name} yet.</p>}
            {canExpandMessages(mirror.messages) && <ShowMoreToggle expanded={expanded} controls={listId} onToggle={() => setExpanded((v) => !v)} />}
            <MirrorFooter url={mirror.channel.url} />
        </>
    );
}

function WarningBanner({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
    return <p role="status" data-testid={testId} className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{children}</p>;
}

function Quiet({ testId, children }: { testId: string; children: ReactNode }): JSX.Element {
    return <p data-testid={testId} className="py-6 text-center text-sm text-muted">{children}</p>;
}

interface BodyProps { mirror: GuildDiscordMirrorDto; canEdit: boolean; onChoose: (() => void) | null }

function MirrorBody({ mirror, canEdit, onChoose }: BodyProps): JSX.Element {
    const name = 'channelName' in mirror && mirror.channelName ? `#${mirror.channelName}` : null;
    const editorHint = canEdit ? ' Choose another channel, or give the bot access again in Discord.' : '';
    switch (mirror.state) {
        case 'ok': return <OkBody mirror={mirror} />;
        case 'disconnected': return <Quiet testId="guild-discord-state-disconnected">Discord isn’t connected right now. Messages will be back once it is.</Quiet>;
        case 'no-access': return <WarningBanner testId="guild-discord-state-no-access">Raid Ledger can no longer read {name ?? 'this channel'}.{editorHint}</WarningBanner>;
        case 'gone': return <WarningBanner testId="guild-discord-state-gone">{name ?? 'The channel'} no longer exists in Discord.{canEdit ? ' Choose another channel.' : ''}</WarningBanner>;
        case 'unset': return (
            <div className="flex flex-col items-start gap-2" data-testid="guild-discord-state-unset">
                <p className="text-sm text-muted">Pick a Discord channel to show its latest messages here, read-only.</p>
                {onChoose && <Button variant="secondary" size="sm" onClick={onChoose} data-testid="guild-discord-choose">Choose channel</Button>}
            </div>
        );
    }
}

interface MirrorProps {
    guildId: number;
    /** Officers included — it only decides the "give the bot access again" hint copy. */
    canEdit: boolean;
    /** Opens the picker behind the settings sheet; `null` for a viewer who may not pick (D10/Q4). */
    onChangeChannel?: (() => void) | null;
    /** ROK-1891 — picks the blurb's fallback phrase ("the server's Discord" on a server hub). */
    kind?: GuildKind | undefined;
}

/** Hidden while loading (no layout jump) and, while nothing is bound, for anyone who cannot pick. */
export function GuildDiscordMirror({ guildId, canEdit, onChangeChannel = null, kind }: MirrorProps): JSX.Element | null {
    const { query, refresh } = useGuildDiscordMirror(guildId);
    const mirror = query.data;
    // Gated on the affordance, not on `canEdit`: an Officer may edit content
    // but not pick a channel (D5-A), so an unset card would be a dead end.
    if (query.isPending || (mirror?.state === 'unset' && onChangeChannel === null)) return null;
    // ROK-1831: a 403 (a visitor on a members-first hub) hides the card — never a red error.
    if (httpStatusOf(query.error) === 403) return null;
    const open = onChangeChannel;
    const action = isMirrorBound(mirror)
        ? <MirrorHeaderAction mirror={mirror} onChange={open} kind={kind} fetching={query.isFetching} onRefresh={() => void refresh()} />
        : undefined;
    return (
        <section id="discord-mirror" aria-labelledby="discord-mirror-title" className="scroll-mt-4 md:col-span-2"
            data-testid="guild-discord-mirror" data-state={mirror?.state ?? 'error'}>
            <SectionTitle headingId="discord-mirror-title" title={mirror ? mirrorTitle(mirror) : 'Discord channel'}
                blurb={mirrorBlurb(mirror, kind)} action={action} />
            <Card>{mirror ? <MirrorBody mirror={mirror} canEdit={canEdit} onChoose={open} /> : <MirrorError onRetry={() => void query.refetch()} />}</Card>
        </section>
    );
}

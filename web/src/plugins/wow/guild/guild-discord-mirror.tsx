/**
 * ROK-1788 (S4 of ROK-1781) — the read-only Discord channel mirror on the
 * guild Overview (approved prototype `DiscordMirror.tsx`, `compact`, span 2).
 * Every state renders inside the card (D9): unset (editors only), Discord
 * disconnected, access lost, channel deleted, and the latest 3 messages.
 * Messages reuse the ROK-1483 `ThreadMessageRow`; the embed block rides in
 * its `children` slot.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { ArrowTopRightOnSquareIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import type { GuildDiscordEmbedDto, GuildDiscordMessageDto, GuildDiscordMirrorDto } from '@raid-ledger/contract';
import { ThreadMessageRow } from '../../../components/discord/ThreadMessageRow';
import { Button } from '../../../components/ui/button';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { Card, SectionTitle } from './guild-bits';
import { boundChannelId, latestMessages, mirrorBlurb, mirrorTitle } from './guild-discord.helpers';
import { GuildDiscordPicker } from './guild-discord-picker';
import { useGuildDiscord } from './use-guild-discord';

type OkMirror = Extract<GuildDiscordMirrorDto, { state: 'ok' }>;

function EmbedBlock({ embed }: { embed: GuildDiscordEmbedDto }): JSX.Element {
    return (
        <div data-testid="guild-discord-embed" className="mt-2 rounded-md border border-edge border-l-4 border-l-success bg-panel px-3 py-2">
            {embed.title && <p className="text-sm font-semibold text-foreground">{embed.title}</p>}
            {embed.description && <p className="whitespace-pre-line break-words text-xs text-muted">{embed.description}</p>}
        </div>
    );
}

function MessageList({ messages, name }: { messages: GuildDiscordMessageDto[]; name: string }): JSX.Element {
    return (
        <ul aria-label={`Latest messages in #${name}`} className="flex flex-col gap-2" data-testid="guild-discord-messages">
            {messages.map((m) => (
                <ThreadMessageRow key={m.messageId} message={m}>
                    {m.embed && <EmbedBlock embed={m.embed} />}
                </ThreadMessageRow>
            ))}
        </ul>
    );
}

function MirrorFooter({ url }: { url: string }): JSX.Element {
    return (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-1">
            <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <LockClosedIcon className="h-3.5 w-3.5" aria-hidden="true" /> Read-only · reply in Discord
            </p>
            <a href={url} target="_blank" rel="noopener noreferrer" data-testid="guild-discord-open"
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-sm text-sm font-medium text-success hover:underline ${FOCUS_RING}`}>
                Open in Discord <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>
        </div>
    );
}

function OkBody({ mirror }: { mirror: OkMirror }): JSX.Element {
    const shown = latestMessages(mirror.messages);
    return (
        <>
            {shown.length > 0
                ? <MessageList messages={shown} name={mirror.channel.name} />
                : <p className="py-6 text-center text-sm text-muted" data-testid="guild-discord-state-empty">No messages in #{mirror.channel.name} yet.</p>}
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

interface BodyProps { mirror: GuildDiscordMirrorDto; canEdit: boolean; onChoose: () => void }

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
                <Button variant="secondary" size="sm" onClick={onChoose} data-testid="guild-discord-choose">Choose channel</Button>
            </div>
        );
    }
}

function MirrorError(): JSX.Element {
    return <p role="alert" className="text-sm text-danger" data-testid="guild-discord-error">Couldn’t load the Discord channel. Try again later.</p>;
}

/** Hidden while loading (no layout jump) and for non-editors while nothing is bound. */
export function GuildDiscordMirror({ guildId, canEdit }: { guildId: number; canEdit: boolean }): JSX.Element | null {
    const [picking, setPicking] = useState(false);
    const query = useGuildDiscord(guildId);
    const mirror = query.data;
    if (query.isPending || (mirror?.state === 'unset' && !canEdit)) return null;
    const open = (): void => setPicking(true);
    const change = canEdit && mirror && mirror.state !== 'unset'
        ? <Button variant="ghost" size="sm" onClick={open} data-testid="guild-discord-change">Change channel</Button>
        : undefined;
    return (
        <section id="discord-mirror" aria-labelledby="discord-mirror-title" className="scroll-mt-4 md:col-span-2"
            data-testid="guild-discord-mirror" data-state={mirror?.state ?? 'error'}>
            <SectionTitle headingId="discord-mirror-title" title={mirror ? mirrorTitle(mirror) : 'Discord channel'}
                blurb={mirrorBlurb(mirror)} action={change} />
            <Card>{mirror ? <MirrorBody mirror={mirror} canEdit={canEdit} onChoose={open} /> : <MirrorError />}</Card>
            {canEdit && picking && (
                <GuildDiscordPicker guildId={guildId} currentId={boundChannelId(mirror)} onClose={() => setPicking(false)} />
            )}
        </section>
    );
}

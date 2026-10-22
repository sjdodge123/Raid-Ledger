/**
 * ROK-1868 W1/W1b — the inline composer: a markdown editor (lazy TipTap chunk,
 * Textarea fallback) and a per-post "Also post to Discord" switch that starts
 * at the hub's remembered default and is disabled with a reason unless the
 * bound channel is usable. The body is checked before submit (§3.3 bodyError).
 */
import { useId, useState, type JSX } from 'react';
import { HUB_POST_BODY_MAX, type CreateHubPostResponse, type GuildKind, type HubPostRelayChannel } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Switch } from '../../ui/switch';
import { LazyMarkdownEditor } from '../../ui/markdown/lazy-markdown-editor';
import { hubCopy } from '../hub-copy';
import { bodyError, relayHint, serverBodyError } from './hub-post.helpers';
import { useCreateHubPost, useHubPostComposer } from './use-hub-posts';

const CHECKING: HubPostRelayChannel = { state: 'disconnected' };

interface RelayRowProps { channel: HubPostRelayChannel | null; checked: boolean; onChange: (on: boolean) => void; kind: GuildKind | undefined; isLeader: boolean }

function RelayRow({ channel, checked, onChange, kind, isLeader }: RelayRowProps): JSX.Element {
    const hintId = useId();
    const hint = channel ? relayHint(channel, kind, isLeader) : { tone: 'muted' as const, text: 'Checking the Discord channel…' };
    return (
        <div className="rounded-lg border border-edge bg-panel p-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">Also post to Discord</span>
                <Switch checked={checked} onChange={onChange} label="Also post to Discord" disabled={channel?.state !== 'ok'}
                    aria-describedby={hintId} testId="hub-post-relay-switch" />
            </div>
            <p id={hintId} className={`mt-1 text-xs ${hint.tone === 'warning' ? 'text-warning' : 'text-muted'}`} data-testid="hub-post-relay-hint">{hint.text}</p>
        </div>
    );
}

export interface PostComposerProps {
    guildId: number;
    kind: GuildKind | undefined;
    /** The hub's leader (vs an officer) — picks the "link a channel" hint. */
    isLeader: boolean;
    onCancel: () => void;
    /** Called after a successful POST with the response (for the relay notice). */
    onPosted: (response: CreateHubPostResponse, channelName: string | null) => void;
}

function useRelayChoice(guildId: number): { channel: HubPostRelayChannel | null; relay: boolean; setRelay: (on: boolean) => void } {
    const composer = useHubPostComposer(guildId, true);
    const [choice, setRelay] = useState<boolean | null>(null);
    const channel = composer.data?.channel ?? (composer.isError ? CHECKING : null);
    const usable = channel?.state === 'ok';
    const relay = usable && (choice ?? composer.data?.relayDefault ?? false);
    return { channel, relay, setRelay };
}

/** Inline composer for editors; Post stays disabled while empty, invalid or pending. */
export function PostComposer({ guildId, kind, isLeader, onCancel, onPosted }: PostComposerProps): JSX.Element {
    const copy = hubCopy(kind);
    const [draft, setDraft] = useState('');
    const { channel, relay, setRelay } = useRelayChoice(guildId);
    const create = useCreateHubPost(guildId);
    const localError = bodyError(draft);
    const error = localError ?? serverBodyError(create.error) ?? (create.isError ? 'Couldn’t publish the post. Try again.' : undefined);
    const channelName = channel?.state === 'ok' ? channel.channelName : null;
    const submit = (): void => create.mutate({ body: draft.trim(), relayToDiscord: relay }, { onSuccess: (res) => onPosted(res, channelName) });
    return (
        <div className="flex flex-col gap-3" data-testid="hub-post-composer">
            <Field label={copy.composerLabel} hint={copy.composerHint} error={error}>
                <LazyMarkdownEditor value={draft} onChange={setDraft} maxLength={HUB_POST_BODY_MAX} testId="hub-post-body" autoFocus />
            </Field>
            <RelayRow channel={channel} checked={relay} onChange={setRelay} kind={kind} isLeader={isLeader} />
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button onClick={submit} loading={create.isPending} disabled={draft.trim() === '' || localError !== null}
                    data-testid="hub-post-submit">Post</Button>
            </div>
        </div>
    );
}

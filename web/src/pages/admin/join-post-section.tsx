/**
 * ROK-1740: admin card for the pinned "Join Raid Ledger" Discord post. Pick a
 * channel, then Post (or Re-post: the bot edits its existing message, or
 * recreates it if a mod deleted it) and, once a post exists, Remove behind a
 * confirm (not rendered while nothing is posted).
 *
 * Server state only (TanStack Query). The last publish result lives in local
 * state because GET carries no pin state: it drives the "pinned" line and the
 * unpinned warning. A 422 shows the missing permissions inline; any other
 * failure (bot offline, Discord unreachable) is a toast with the server's text.
 */
import { useState } from 'react';
import type { DiscordJoinPostResult, JoinPostPermissionName } from '@raid-ledger/contract';
import { toast } from '../../lib/toast';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { ChannelSelector } from '../../components/admin/channel-selector';
import { joinPostMissing, useJoinPostSettings } from '../../hooks/admin/use-join-post-settings';
import { JoinPostMissingPermissions, JoinPostPinWarning } from './join-post-banners';

const DESCRIPTION =
    'The bot posts and pins a message with a Join Raid Ledger button so server members can sign in.';

/** Query + mutation wiring, the picked channel and the last outcome. */
function useJoinPostCard() {
    const { status, channels, publish, remove } = useJoinPostSettings();
    const [picked, setPicked] = useState<string | null>(null);
    const [result, setResult] = useState<DiscordJoinPostResult | null>(null);
    const [missing, setMissing] = useState<JoinPostPermissionName[] | null>(null);
    const stored = status.data ?? { channelId: null, messageId: null };
    const channelId = picked ?? stored.channelId ?? '';
    const list = channels.data ?? [];
    const nameOf = (id: string | null) => list.find((c) => c.id === id)?.name ?? 'unknown-channel';

    const post = () => {
        setMissing(null);
        publish.mutate(channelId, {
            onSuccess: (r) => { setResult(r); toast.success(`Join post ${r.outcome} in #${nameOf(r.channelId)}`); },
            onError: (err) => {
                const names = joinPostMissing(err);
                if (names) setMissing(names); else toast.error(err.message);
            },
        });
    };
    const unpost = (done: () => void) => remove.mutate(undefined, {
        onSuccess: () => { setResult(null); setMissing(null); toast.success('Join post removed'); done(); },
        onError: (err) => toast.error(err.message),
    });
    return { stored, channelId, setPicked, list, nameOf, result, missing, post, unpost,
        publishing: publish.isPending, removing: remove.isPending, loading: !status.data };
}

type Card = ReturnType<typeof useJoinPostCard>;

function StatusLine({ card }: { card: Card }) {
    const { stored, result, nameOf } = card;
    if (!stored.messageId) {
        return <p data-testid="join-post-status" className="text-sm text-muted">Not posted yet.</p>;
    }
    const pin = result ? (result.pinned ? ' · pinned' : ' · not pinned') : '';
    return (
        <p data-testid="join-post-status" className="text-sm text-secondary">
            Posted in <span className="text-foreground font-medium">#{nameOf(stored.channelId)}</span>{pin}
        </p>
    );
}

function RemoveConfirm({ card, open, onClose }: { card: Card; open: boolean; onClose: () => void }) {
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose} disabled={card.removing}>Cancel</Button>
            <Button variant="destructive" onClick={() => card.unpost(onClose)}
                loading={card.removing} loadingLabel="Removing...">Remove post</Button>
        </>
    );
    return (
        <Modal isOpen={open} onClose={() => { if (!card.removing) onClose(); }} title="Remove the join post?" footer={footer}>
            <p className="text-secondary">
                The bot deletes its join message from #{card.nameOf(card.stored.channelId)}. You can post it again any time.
            </p>
        </Modal>
    );
}

function Actions({ card, onRemove }: { card: Card; onRemove: () => void }) {
    const hasPost = !!card.stored.messageId;
    return (
        <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="primary" onClick={card.post} disabled={!card.channelId || card.removing}
                loading={card.publishing} loadingLabel="Posting..." className="w-full sm:w-auto">
                {hasPost ? 'Re-post' : 'Post'}
            </Button>
            {hasPost && (
                <Button variant="destructive-soft" onClick={onRemove} disabled={card.publishing || card.removing}
                    className="w-full sm:w-auto">
                    Remove
                </Button>
            )}
        </div>
    );
}

/** Join post card on the Discord Features page. */
export function JoinPostSection(): React.ReactElement {
    const card = useJoinPostCard();
    const [confirming, setConfirming] = useState(false);
    const { result, missing } = card;
    return (
        <div className="bg-surface rounded-xl border border-edge p-6 space-y-4" data-testid="join-post-section">
            <div>
                <h3 className="text-base font-semibold text-foreground">Join post</h3>
                <p className="text-sm text-muted mt-1">{DESCRIPTION}</p>
            </div>
            <ChannelSelector id="join-post-channel" label="Channel" channels={card.list} value={card.channelId}
                isPending={card.publishing || card.removing} disabled={card.loading} prefix="#" framed={false} fieldSize="md"
                hint="Where the bot posts and pins the join message."
                onChange={async (v) => { card.setPicked(v); }} onError={() => undefined} />
            <StatusLine card={card} />
            {missing && <JoinPostMissingPermissions channelName={card.nameOf(card.channelId)} missing={missing} />}
            {result && !result.pinned && result.warning && <JoinPostPinWarning warning={result.warning} />}
            <Actions card={card} onRemove={() => setConfirming(true)} />
            <RemoveConfirm card={card} open={confirming} onClose={() => setConfirming(false)} />
        </div>
    );
}

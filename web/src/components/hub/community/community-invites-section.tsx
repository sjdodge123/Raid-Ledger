/**
 * ROK-1893 P1 (ruling §8a(a), §8d) — community-hub invite links.
 *
 * - `HubInviteAction`: the Members-tab "Invite people" action, shown to every
 *   live member of an active hub. Opens the copy-link dialog (approved
 *   wireframe `InviteFrames.tsx`): the newest link + Copy, "Your links" with
 *   joined count + Revoke, and the expiry choice + Create (7-day default).
 *   `Modal` at ≥1024px, `BottomSheet` below (design-system §4.4).
 * - `CommunityInvitesSettingsSection`: every live link on the hub, for the
 *   Leader/Officer in the hub settings sheet, with the maker and Revoke.
 */
import { useState, type JSX } from 'react';
import type { HubInvite } from '@raid-ledger/contract';
import type { HubCtx } from '../../../plugins/hub-module';
import { useAuth } from '../../../hooks/use-auth';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { CopyButton } from '../../ui/CopyButton';
import { Input } from '../../ui/input';
import { Modal } from '../../ui/modal';
import { SettingsSection } from '../settings/settings-rows';
import { useHubInvites } from './hub-invites-api';
import { isLiveInvite } from './community-invite-helpers';
import { canInvite } from './community-invite-access';
import { CreateInviteRow, InviteRows } from './community-invite-rows';

const LOAD_ERROR = 'Couldn’t load invite links. Try again later.';

function liveItems(items: HubInvite[], makerId: number | null): HubInvite[] {
    const now = Date.now();
    return items.filter((i) => isLiveInvite(i, now) && (makerId === null || i.createdBy?.id === makerId));
}

function NewestLink({ invite }: { invite: HubInvite | undefined }): JSX.Element | null {
    if (!invite?.url) return null;
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2">
                <Input readOnly value={invite.url} aria-label="Invite link" className="font-mono" data-testid="hub-invite-url" />
                <CopyButton text={invite.url} />
            </div>
            <p className="text-xs text-muted">Works for anyone already in the community&apos;s Discord server.</p>
        </div>
    );
}

function InviteDialogBody({ hubId }: { hubId: number }): JSX.Element {
    const { user } = useAuth();
    const list = useHubInvites(hubId);
    if (list.isPending) return <p className="text-sm text-secondary">Loading…</p>;
    if (list.isError) return <p role="alert" className="text-sm text-danger">{LOAD_ERROR}</p>;
    const mine = liveItems(list.data.items, user?.id ?? -1);
    const newest = [...mine].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return (
        <div className="space-y-4">
            <NewestLink invite={newest} />
            <CreateInviteRow hubId={hubId} list={list.data} />
            {mine.length > 0 && (
                <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your links</p>
                    <InviteRows hubId={hubId} items={mine} showMaker={false} />
                </div>
            )}
        </div>
    );
}

/** #1742's copy-link dialog — also opened by the community setup checklist's Invite step (ROK-1891). */
export function HubInviteDialog({ hubId, title, onClose }: { hubId: number; title: string; onClose: () => void }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (isDesktop) {
        return (
            <Modal isOpen onClose={onClose} title={title} maxWidth="max-w-lg" footer={<Button size="sm" onClick={onClose}>Done</Button>}>
                <InviteDialogBody hubId={hubId} />
            </Modal>
        );
    }
    return (
        <BottomSheet isOpen onClose={onClose} title={title} maxHeight="85vh" footer={<Button fullWidth onClick={onClose}>Done</Button>}>
            <InviteDialogBody hubId={hubId} />
        </BottomSheet>
    );
}

/** The Members-tab "Invite people" action + its dialog. */
export function HubInviteAction(ctx: HubCtx): JSX.Element | null {
    const [open, setOpen] = useState(false);
    if (!canInvite(ctx)) return null;
    const hub = ctx.page.guild;
    return (
        <>
            <Button variant="secondary" size="sm" data-testid="hub-invite-open" onClick={() => setOpen(true)}>Invite people</Button>
            {open && <HubInviteDialog hubId={hub.id} title={`Invite people to ${hub.name}`} onClose={() => setOpen(false)} />}
        </>
    );
}

/** Leader/Officer (settings sheet): every live link on the hub. */
export function CommunityInvitesSettingsSection({ hubId }: { hubId: number }): JSX.Element {
    const list = useHubInvites(hubId);
    const items = list.data ? liveItems(list.data.items, null) : [];
    return (
        <SettingsSection title="Invite links" blurb="Every live invite link on this hub." testId="community-settings-invites">
            {list.isPending && <p className="text-sm text-secondary">Loading…</p>}
            {list.isError && <p role="alert" className="text-sm text-danger">{LOAD_ERROR}</p>}
            {list.isSuccess && items.length === 0 && <p className="text-sm text-muted">No live invite links.</p>}
            {items.length > 0 && <InviteRows hubId={hubId} items={items} showMaker />}
        </SettingsSection>
    );
}

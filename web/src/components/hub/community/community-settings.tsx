/**
 * ROK-1870 §3.1 — what a community hub adds to the settings sheet: the blurb
 * (editors), the Banned list with Unban (editors), and the lifecycle row —
 * "Archive hub" for the Leader, "Restore hub" for staff only (§2.5).
 *
 * §2.3 has no blurb-edit route yet, so the blurb renders disabled with the
 * reason in its hint — the sheet's "never invent an endpoint" rule
 * (`settings-rows.tsx`).
 */
import { useState, type JSX } from 'react';
import { HUB_BLURB_MAX } from '@raid-ledger/contract';
import type { HubCtx } from '../../../plugins/hub-module';
import { isOperatorOrAdmin, useAuth } from '../../../hooks/use-auth';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Textarea } from '../../ui/textarea';
import { SettingsSection } from '../settings/settings-rows';
import { useHubBans, useHubStatus, useHubUnban } from './community-settings-api';

function BlurbSection({ blurb }: { blurb: string | null }): JSX.Element {
    return (
        <SettingsSection title="Description" testId="community-settings-blurb">
            <Field label="Short description" hint="Editing the description isn’t available yet.">
                <Textarea value={blurb ?? ''} maxLength={HUB_BLURB_MAX} showCount disabled readOnly rows={3} />
            </Field>
        </SettingsSection>
    );
}

function BannedSection({ hubId }: { hubId: number }): JSX.Element {
    const bans = useHubBans(hubId, true);
    const unban = useHubUnban(hubId);
    const items = bans.data?.items ?? [];
    return (
        <SettingsSection title="Banned" blurb="Banned people can’t join until unbanned." testId="community-settings-banned">
            {bans.isPending && <p className="text-sm text-secondary">Loading…</p>}
            {bans.isError && <p role="alert" className="text-sm text-danger">Couldn’t load the Banned list. Try again later.</p>}
            {bans.isSuccess && items.length === 0 && <p className="text-sm text-muted">Nobody is banned.</p>}
            <ul className="flex flex-col gap-2">
                {items.map((b) => (
                    <li key={b.userId} className="flex items-center justify-between gap-3" data-testid="community-banned-row">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{b.username}</p>
                            {b.reason !== null && <p className="truncate text-sm text-muted">Reason: {b.reason}</p>}
                        </div>
                        <Button variant="ghost" size="sm" aria-label={`Unban ${b.username}`} disabled={unban.isPending}
                            onClick={() => unban.mutate(b.userId)}>Unban</Button>
                    </li>
                ))}
            </ul>
        </SettingsSection>
    );
}

function ArchiveRow({ hubId }: { hubId: number }): JSX.Element {
    const status = useHubStatus(hubId);
    const [confirming, setConfirming] = useState(false);
    if (!confirming) {
        return <div><Button variant="destructive-soft" size="sm" onClick={() => setConfirming(true)}>Archive hub</Button></div>;
    }
    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="community-archive-prompt">
            <span className="text-sm text-secondary">Archive this hub? Only staff can restore it.</span>
            <Button variant="destructive" size="sm" data-testid="community-archive-confirm" disabled={status.isPending}
                onClick={() => { setConfirming(false); status.mutate('archived'); }}>Archive</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
    );
}

function LifecycleSection({ ctx }: { ctx: HubCtx }): JSX.Element | null {
    const { user } = useAuth();
    const status = useHubStatus(ctx.page.guild.id);
    const c = ctx.page.community;
    if (c === undefined) return null;
    const archive = c.status === 'active' && ctx.page.viewer.role === 'leader';
    const restore = c.status === 'archived' && isOperatorOrAdmin(user);
    if (!archive && !restore) return null;
    return (
        <SettingsSection title="Hub status" testId="community-settings-status">
            {archive && <ArchiveRow hubId={ctx.page.guild.id} />}
            {restore && (
                <div><Button variant="secondary" size="sm" disabled={status.isPending}
                    onClick={() => status.mutate('active')}>Restore hub</Button></div>
            )}
        </SettingsSection>
    );
}

/** The community hub's settings-sheet sections (`HubModule.settingsSections`). */
export function CommunitySettingsSections(ctx: HubCtx): JSX.Element | null {
    if (ctx.page.community === undefined) return null;
    const canEdit = ctx.page.viewer.canEdit;
    return (
        <>
            {canEdit && <BlurbSection blurb={ctx.page.community.blurb} />}
            {canEdit && <BannedSection hubId={ctx.page.guild.id} />}
            <LifecycleSection ctx={ctx} />
        </>
    );
}

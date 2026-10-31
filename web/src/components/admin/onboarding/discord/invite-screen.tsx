import { useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../ui/button';
import { buttonClass } from '../../../ui/button-classes';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { copyWithToast } from '../../../../lib/clipboard';
import { useBotInviteInfo } from '../../../../hooks/admin/use-lfg-board-settings';
import type { DiscordBotPermissionsResult } from '../../../../hooks/admin/admin-settings-types';
import { SubstepFooter, SubstepScreen, type SubstepNav } from './substep-screen';
import { useWaitForBotJoin } from './use-wait-for-bot-join';

function permissionsLine(perms: DiscordBotPermissionsResult | undefined): string {
    if (!perms) return 'Checking its permissions…';
    if (perms.allGranted) return `All ${perms.permissions.length} permissions granted.`;
    const missing = perms.permissions.filter((p) => !p.granted).length;
    return `${missing} permission${missing === 1 ? ' is' : 's are'} missing. The next screen lists them.`;
}

/** The live region: idle → waiting (polling) → joined + permission result. */
function JoinStatus({ waiting, guildName, perms }: { waiting: boolean; guildName: string | undefined; perms: DiscordBotPermissionsResult | undefined }) {
    if (guildName) {
        return (
            <div role="status" data-testid="bot-join-status" data-state="joined" className="flex gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                <span aria-hidden="true">✓</span>
                <span><strong>Your bot joined {guildName}.</strong> {permissionsLine(perms)}</span>
            </div>
        );
    }
    return (
        <div role="status" data-testid="bot-join-status" data-state={waiting ? 'waiting' : 'idle'} className="flex gap-3 rounded-lg border border-edge bg-panel/50 p-3 text-sm text-secondary">
            {waiting && <ArrowPathIcon className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted" aria-hidden="true" />}
            {waiting
                ? <div><strong className="text-foreground">Waiting for your bot to join…</strong><div className="text-muted">Checking every few seconds. Keep this page open.</div></div>
                : <span>Waiting for you to open the invite.</span>}
        </div>
    );
}

function InviteLinkField({ url, onUse }: { url: string | null | undefined; onUse: () => void }) {
    const [copied, setCopied] = useState(false);
    const copy = async (): Promise<void> => {
        if (url && await copyWithToast(url, { error: 'Failed to copy the invite link' })) { setCopied(true); onUse(); }
    };
    return (
        <Field label="Your bot's invite link" hint="Discord lists every permission on its approval screen. Leave them all ticked; the next screen checks each one.">
            <Input readOnly mono value={url ?? 'Loading…'} className="min-w-0" />
            <div className="mt-2 flex flex-wrap gap-2">
                {url
                    ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={onUse} className={buttonClass({ variant: 'primary' })}>Open invite</a>
                    : <Button disabled>Open invite</Button>}
                <Button variant="secondary" onClick={copy} disabled={!url} aria-label={copied ? 'Invite link copied' : 'Copy invite link'}>{copied ? 'Copied ✓' : 'Copy'}</Button>
            </div>
        </Field>
    );
}

/** 4d — "Invite your bot to your server" (approved sheet Discord4; spec AC-8, D-8). */
export function InviteScreen({ onNext, onBack }: SubstepNav) {
    const invite = useBotInviteInfo();
    const [waiting, setWaiting] = useState(false);
    const { bot, joined, permissions } = useWaitForBotJoin(waiting);
    return (
        <SubstepScreen step={4} title="Invite your bot to your server"
            lead={<>Open the invite, pick <strong className="text-foreground">one</strong> server (the one your community uses) and approve it. Raid Ledger works with a single server.</>}
            footer={<SubstepFooter onBack={onBack}><Button onClick={onNext} disabled={!joined}>Continue</Button></SubstepFooter>}>
            <InviteLinkField url={invite.data?.url} onUse={() => setWaiting(true)} />
            <JoinStatus waiting={waiting} guildName={joined ? bot?.guildName : undefined} perms={permissions} />
            <p className="text-sm text-muted">You need Manage Server on that server. If it isn't in Discord's list, you're not an admin there: ask the owner to open the invite.</p>
        </SubstepScreen>
    );
}

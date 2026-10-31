import type { ReactNode } from 'react';
import { Button } from '../../../ui/button';
import { Field } from '../../../ui/field';
import { Select } from '../../../ui/select';
import { StatusChip } from '../../../ui/status-chip';
import type { DiscordBotPermissionsResult } from '../../../../hooks/admin/admin-settings-types';
import { PermissionsResult } from '../../discord-shared/permissions-result';
import { SubstepFooter, SubstepNote, SubstepScreen, type SubstepNav } from './substep-screen';
import { useBotPermissions, useBotStatus, isBotJoined } from './use-wait-for-bot-join';
import { useDefaultChannel } from './use-default-channel';

export interface BotJoinedScreenProps extends SubstepNav {
    /** D-9: completes onboarding and opens Admin → Discord. 4e only (AC-10). */
    onFinishLater: () => void;
}

function CheckRow({ ok, pending, children }: { ok: boolean; pending?: boolean; children: ReactNode }) {
    const tone = pending ? 'neutral' : ok ? 'success' : 'warning';
    const label = pending ? '…' : ok ? 'ok' : 'fix';
    return (
        <li className="flex items-center gap-3 text-sm text-foreground">
            <StatusChip tone={tone} title={pending ? 'Checking' : ok ? 'Done' : 'Needs attention'}>{label}</StatusChip>
            <span>{children}</span>
        </li>
    );
}

function permissionsText(perms: DiscordBotPermissionsResult | undefined): string {
    if (!perms) return 'Checking permissions…';
    return perms.allGranted ? `All ${perms.permissions.length} permissions granted` : 'Some permissions are missing';
}

/**
 * The three checks. Intents: the bot connects with all three privileged
 * intents requested, and Discord refuses that connection (4014) while any is
 * off, so a connected bot proves all three are on.
 */
function Checklist({ connected, perms }: { connected: boolean; perms: DiscordBotPermissionsResult | undefined }) {
    return (
        <div className="space-y-3">
            <ul className="space-y-2" aria-label="Bot checks" data-testid="bot-checklist">
                <CheckRow ok={connected}>Bot signed in to Discord</CheckRow>
                <CheckRow ok={!!perms?.allGranted} pending={!perms}>{permissionsText(perms)}</CheckRow>
                <CheckRow ok={connected}>Presence, Server Members and Message Content switched on</CheckRow>
            </ul>
            {perms && !perms.allGranted && <PermissionsResult result={perms} />}
        </div>
    );
}

function ChannelField({ ch }: { ch: ReturnType<typeof useDefaultChannel> }) {
    const empty = !ch.loading && (ch.channels?.length ?? 0) === 0;
    const hint = empty ? "Your bot can't see any text channels yet — check its View Channel permission." : 'You can change this any time.';
    return (
        <Field label="Post new events in" hint={hint}>
            <Select value={ch.value} onChange={(e) => ch.setValue(e.target.value)} disabled={empty || ch.loading} placeholder="Choose a channel" data-testid="default-channel-select">
                {(ch.channels ?? []).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </Select>
        </Field>
    );
}

function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/** 4e — "Your bot is in <server>" (approved sheet Discord5; spec AC-9, AC-10, D-9, D-10). */
export function BotJoinedScreen({ onNext, onBack, onFinishLater }: BotJoinedScreenProps) {
    const { data: bot } = useBotStatus();
    const joined = isBotJoined(bot);
    const { data: perms } = useBotPermissions(joined);
    const ch = useDefaultChannel(joined);
    const guild = bot?.guildName ?? 'your server';
    const members = bot?.memberCount !== undefined ? ` · ${bot.memberCount} members` : '';
    return (
        <SubstepScreen step={5} title={`Your bot is in ${guild}`}
            lead={<span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-overlay text-xs font-semibold text-foreground">{initials(guild)}</span><span className={bot?.connected ? 'text-success' : 'text-muted'}>{bot?.connected ? `Online${members}` : 'Offline'}</span></span>}
            footer={<SubstepFooter onBack={onBack}>
                <Button variant="secondary" onClick={() => void ch.saveThen(onFinishLater)} disabled={ch.saving}>Finish later</Button>
                <Button onClick={() => void ch.saveThen(onNext)} disabled={ch.saving}>Continue</Button>
            </SubstepFooter>}>
            {(bot?.guildCount ?? 0) > 1 && (
                <div role="alert"><SubstepNote tone="warning"><strong>Your bot is in {bot?.guildCount} servers.</strong> Raid Ledger only uses {guild}, the first one it joined. Remove the bot from the other server.</SubstepNote></div>
            )}
            <Checklist connected={!!bot?.connected} perms={perms} />
            <ChannelField ch={ch} />
        </SubstepScreen>
    );
}

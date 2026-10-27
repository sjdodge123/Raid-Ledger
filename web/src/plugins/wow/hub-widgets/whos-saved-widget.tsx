/**
 * ROK-1914 (W6, plan H14) — WoW: Forever "Who's saved" Overview card body.
 * One row per saved instance (name · difficulty · "N saved" · "Resets in …");
 * expanding it lists the saved members, each linked to their character with
 * their boss kills. Same disclosure structure as Guild professions
 * (`ProfessionRow`). Always all characters, never mains-only (D4): the point
 * is spotting saved alts. Core draws the `WidgetCard` chrome; the
 * registration (`whos-saved.register.ts`) gates it to members + staff.
 * The reporting line counts `lockoutReporters` (characters whose export
 * carried lockouts), not every addon-sourced character: a guild-only import
 * says nothing about saves.
 */
import { useState, type JSX } from 'react';
import { CharacterLink } from '../../../components/hub/character-link';
import { Button } from '../../../components/ui/button';
import { useNowTick } from '../../../hooks/use-now-tick';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { formatResetIn } from '../lib/lockout-reset';
import { useRosterInsights } from './use-roster-insights';
import {
    isCleared, liveLockouts, lockoutInstants, reportingLine, type LockoutMember, type RosterLockout,
} from './whos-saved.helpers';

const NO_LOCKOUTS: readonly RosterLockout[] = [];

/** The Who's saved widget body (lazy-loaded). */
export default function WhosSavedWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id, false);
    const all = data?.lockouts ?? NO_LOCKOUTS;
    const nowMs = useNowTick(lockoutInstants(all));
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load lockouts.</p>;
    const lockouts = liveLockouts(all, nowMs);
    const footer = (
        <p data-testid="whos-saved-footer" className="text-xs text-dim">
            {reportingLine(data.lockoutReporters ?? 0)}
        </p>
    );
    if (lockouts.length === 0) {
        return (
            <div data-testid="whos-saved-empty" className="flex flex-col gap-2">
                <p className="text-sm text-muted">No one is saved to an instance right now.</p>
                {footer}
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            <ul className="divide-y divide-edge" aria-label="Saved instances">
                {lockouts.map((l) => <LockoutRow key={`${l.instanceId}:${l.difficultyId}`} lockout={l} nowMs={nowMs} />)}
            </ul>
            {footer}
        </div>
    );
}

function LockoutRow({ lockout, nowMs }: { lockout: RosterLockout; nowMs: number }): JSX.Element {
    const [open, setOpen] = useState(false);
    const resetIn = formatResetIn(lockout.resetAt, nowMs);
    const detail = [lockout.difficulty, resetIn].filter((s): s is string => s !== null).join(' · ');
    return (
        <li className="py-1.5">
            <Button type="button" variant="bare" fullWidth aria-expanded={open} onClick={() => setOpen((v) => !v)}
                className="min-h-11 rounded-sm text-left text-sm hover:opacity-80">
                <span className="flex w-full flex-col gap-0.5">
                    <span className="flex w-full items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium text-foreground">{lockout.name}</span>
                        <span className="shrink-0 text-xs text-muted">{lockout.members.length} saved</span>
                    </span>
                    {detail !== '' && <span className="text-xs text-muted">{detail}</span>}
                </span>
            </Button>
            {open && <MemberList lockout={lockout} nowMs={nowMs} />}
        </li>
    );
}

function MemberList({ lockout, nowMs }: { lockout: RosterLockout; nowMs: number }): JSX.Element {
    return (
        <ul aria-label={`${lockout.name} saved members`} className="mt-1 flex flex-col gap-1 pl-3">
            {lockout.members.map((m) => <MemberRow key={m.characterId} member={m} lockout={lockout} nowMs={nowMs} />)}
        </ul>
    );
}

function MemberRow({ member, lockout, nowMs }: { member: LockoutMember; lockout: RosterLockout; nowMs: number }): JSX.Element {
    const ownReset = member.resetAt === lockout.resetAt ? null : formatResetIn(member.resetAt, nowMs);
    const tone = isCleared(member.killed, lockout.total) ? 'text-success' : 'text-foreground';
    return (
        <li className="flex items-center justify-between gap-2 text-sm">
            <CharacterLink name={member.name} characterId={member.characterId} className="min-w-0 truncate text-foreground" />
            <span className="flex shrink-0 items-center gap-2">
                {ownReset !== null && <span className="text-xs text-muted">{ownReset}</span>}
                <span data-testid="whos-saved-kills" className={`font-mono tabular-nums ${tone}`}>
                    {member.killed}/{lockout.total}
                </span>
            </span>
        </li>
    );
}

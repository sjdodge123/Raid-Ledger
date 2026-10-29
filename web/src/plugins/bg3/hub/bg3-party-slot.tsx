/**
 * ROK-1958 §3.1 — one BG3 party member tile. New pattern (spec §5): race /
 * class / level / origin + an XP-to-next-level bar (operator Q3, `xpProgress`,
 * full at level 12) + the claim footer. Tokens only.
 */
import type { JSX } from 'react';
import type { Bg3PartySlot } from '@raid-ledger/contract';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import { bg3ClassesLabel, bg3ClassLabel, bg3OriginLabel, bg3RaceLabel } from '../lib/bg3-labels';
import { xpProgress } from '../lib/bg3-xp';
import { Bg3ClaimControl, type Bg3ClaimControlProps } from './bg3-claim-control';

export type Bg3PartySlotTileProps = Omit<Bg3ClaimControlProps, 'slotKey' | 'claim' | 'slotLabel'> & {
    readonly slot: Bg3PartySlot;
};

/** "Wood Elf Barbarian" — race + first class, for the × label. */
function bg3SlotLabel(slot: Bg3PartySlot): string {
    const first = slot.classes[0];
    const race = bg3RaceLabel(slot.race);
    return first === undefined ? race : `${race} ${bg3ClassLabel({ main: first.main, sub: null })}`;
}

function XpLine({ slot }: { slot: Bg3PartySlot }): JSX.Element {
    const xp = xpProgress(slot.level, slot.xpTotal);
    const text = xp.atMax || xp.toNext === null
        ? 'Max level'
        : `${xp.toNext.toLocaleString('en-US')} XP to Level ${slot.level + 1}`;
    return (
        <div className="mt-2 flex flex-col gap-1" data-testid="bg3-party-xp">
            <GuildMeter pct={xp.fraction * 100} label={`${bg3SlotLabel(slot)}: ${text}`} />
            <span className="text-xs text-muted tabular-nums">{text}</span>
        </div>
    );
}

export function Bg3PartySlotTile({ slot, ...claim }: Bg3PartySlotTileProps): JSX.Element {
    return (
        <li className="flex min-w-0 flex-col rounded-lg border border-edge bg-panel p-3" data-testid="bg3-party-slot"
            data-slot-key={slot.slotKey ?? undefined}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">{bg3RaceLabel(slot.race)}</span>
                <span className="shrink-0 font-mono text-xs text-secondary">Level {slot.level}</span>
            </div>
            <span className="mt-0.5 text-sm text-secondary">{bg3ClassesLabel(slot.classes)}</span>
            <span className="mt-0.5 text-xs text-muted">{bg3OriginLabel(slot.origin)}</span>
            <XpLine slot={slot} />
            <Bg3ClaimControl slotKey={slot.slotKey} claim={slot.claim} slotLabel={bg3SlotLabel(slot)} {...claim} />
        </li>
    );
}

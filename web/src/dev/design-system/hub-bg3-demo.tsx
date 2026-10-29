/**
 * ROK-1958 — sample bodies for the three BG3 patterns on /dev/design-system
 * (§4.27): the party slot tile, the party coverage strip and the session
 * timeline rail. They render the REAL presentational components over
 * anonymised data, so both colour families come from the tokens they ship.
 */
import type { ComponentType, JSX } from 'react';
import type { Bg3PartySlot, Bg3Session } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../plugins/hub-game-widgets';
import { Bg3PartySlotTile } from '../../plugins/bg3/hub/bg3-party-slot';
import { Bg3PartyCoverage } from '../../plugins/bg3/hub/bg3-party-coverage';
import { Bg3SessionRow } from '../../plugins/bg3/hub/bg3-session-row';

const noop = (): void => undefined;

function slot(over: Partial<Bg3PartySlot>): Bg3PartySlot {
    return {
        origin: 'Generic', race: 'Human', level: 8, xpLevel: 5630, xpTotal: 35630,
        classes: [{ main: 'Wizard', sub: 'NecromancySchool' }], isSummon: false,
        slotKey: 'Generic:Human:1', claim: null, ...over,
    };
}

const PARTY: readonly Bg3PartySlot[] = [
    slot({ race: 'Elf_WoodElf', classes: [{ main: 'Barbarian', sub: 'BerserkerPath' }], slotKey: 'Generic:Elf_WoodElf:1',
        claim: { userId: 1, displayName: 'Moonwhisper', avatarUrl: null } }),
    slot({}),
];

const SESSIONS: readonly Bg3Session[] = [
    { startedAt: '2026-10-27T19:40:00.000Z', endedAt: '2026-10-27T23:05:00.000Z', saveCount: 14, partyLevelFrom: 7,
        partyLevelTo: 8, areas: ['WLD_Main_A', 'CRE_Main_A', 'SCL_Main_A'], lastSaveId: 2, thumbnailUrl: null },
    { startedAt: '2026-10-24T12:00:00.000Z', endedAt: '2026-10-24T12:00:00.000Z', saveCount: 1, partyLevelFrom: 7,
        partyLevelTo: 7, areas: ['WLD_Main_A'], lastSaveId: 1, thumbnailUrl: null },
];

/** Party slot tile (claimed by someone else + unclaimed) over the coverage strip. */
export const Bg3PartyDemoBody: ComponentType<HubWidgetCtx> = (): JSX.Element => (
    <div className="flex flex-col gap-3">
        <Bg3PartyCoverage party={PARTY} />
        <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2" aria-label="Party">
            {PARTY.map((s) => (
                <Bg3PartySlotTile key={s.slotKey} slot={s} viewerId={2} canClaim canRemoveOthers={false}
                    onClaim={noop} onUnclaim={noop} />
            ))}
        </ul>
    </div>
);

/** Session timeline rail — latest dot `bg-success`, the rest `bg-edge-strong`. */
export const Bg3SessionsDemoBody: ComponentType<HubWidgetCtx> = (): JSX.Element => (
    <ol className="ml-1.5 border-l-2 border-edge pl-4" aria-label="Sessions">
        {SESSIONS.map((s, i) => <Bg3SessionRow key={s.lastSaveId} session={s} latest={i === 0} timeZone="UTC" />)}
    </ol>
);

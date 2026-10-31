/** ROK-1960 L3 — pure helpers for the upload sheet (kept out of the component files for fast refresh). */
import type { Bg3CampaignSummary, Bg3CrossHubMove, Bg3KeyLocation, Bg3PartyMember } from '@raid-ledger/contract';
import { bg3ClassesLabel, bg3RaceLabel, bg3SummonName } from '../lib/bg3-labels';

/** "Wood Elf · Barbarian · Level 8"; a summon is named, not classed. */
export function bg3MemberLine(m: Bg3PartyMember): string {
    if (m.isSummon) return `${bg3SummonName(m.origin)} · Summon`;
    return `${bg3RaceLabel(m.race)} · ${bg3ClassesLabel(m.classes)} · Level ${m.level}`;
}

/** The user's default when it is a live campaign of this hub, else the hub's active one. */
export function bg3InitialUploadCampaign(campaigns: readonly Bg3CampaignSummary[], defaultId: number | null, activeId: number | null): number | null {
    const live = (id: number | null): boolean => campaigns.some((c) => c.id === id && c.archivedAt === null);
    if (live(defaultId)) return defaultId;
    return live(activeId) ? activeId : null;
}

function earlierSaves(n: number): string {
    if (n === 0) return 'Moving it here files its next saves here instead.';
    return `Moving it here also moves your ${n} earlier ${n === 1 ? 'save' : 'saves'}.`;
}

const HIDDEN_HUB = 'a hub you can no longer open';

function placeOf(at: Bg3KeyLocation): string {
    return at.campaignName !== null && at.hubName !== null ? `${at.campaignName} in ${at.hubName}` : HIDDEN_HUB;
}

/** "A", "A and B", "A, B and C" — each place once. */
function joinPlaces(places: readonly string[]): string {
    const unique = [...new Set(places)];
    const last = unique.pop() ?? HIDDEN_HUB;
    return unique.length === 0 ? last : `${unique.join(', ')} and ${last}`;
}

/** The cross-hub confirm (operator ruling 2026-10-31), from the bind's 409 `cross_hub_move` body. */
export function bg3MoveConfirmText(move: Bg3CrossHubMove): string {
    return `This playthrough's saves are in ${joinPlaces(move.locations.map(placeOf))}. ${earlierSaves(move.saveCount)}`;
}

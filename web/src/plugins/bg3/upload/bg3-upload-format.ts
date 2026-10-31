/** ROK-1960 L3 — pure helpers for the upload sheet (kept out of the component files for fast refresh). */
import type { Bg3CampaignKeyBinding, Bg3CampaignSummary, Bg3PartyMember } from '@raid-ledger/contract';
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

/** Unbound or bound inside this hub → bind silently; any other hub (or one the caller can't read) → ask. */
export function isBg3CrossHubBinding(binding: Bg3CampaignKeyBinding | null, hubId: number): binding is Bg3CampaignKeyBinding {
    return binding !== null && binding.hubId !== hubId;
}

function earlierSaves(n: number): string {
    if (n === 0) return 'Moving it here files its next saves here instead.';
    return `Moving it here also moves your ${n} earlier ${n === 1 ? 'save' : 'saves'}.`;
}

export function bg3MoveConfirmText(binding: Bg3CampaignKeyBinding): string {
    const where = binding.campaignName !== null && binding.hubName !== null
        ? `${binding.campaignName} in ${binding.hubName}`
        : 'a hub you can no longer open';
    return `This playthrough's saves are in ${where}. ${earlierSaves(binding.saveCount)}`;
}

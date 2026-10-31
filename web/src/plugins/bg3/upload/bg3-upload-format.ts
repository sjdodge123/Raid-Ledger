/** ROK-1960 L3 — pure helpers for the upload sheet (kept out of the component files for fast refresh). */
import type { Bg3CampaignSummary, Bg3PartyMember } from '@raid-ledger/contract';
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

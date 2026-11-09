/** ROK-2149 — the no-Armory note's copy, kept out of the sections component file (react-refresh). */
import type { RosterMemberNoArmoryReason } from '@raid-ledger/contract';

/** D1 copy — one sentence per reason (design-system §4.5). */
export const NO_ARMORY_COPY: Record<RosterMemberNoArmoryReason, string> = {
    no_blizzard_id: "Not on the Blizzard roster yet, so there's no Armory data.",
    below_level_10: 'Blizzard shows the Armory from level 10.',
    invalid_name: "This name can't be looked up on the Armory.",
    not_found: "The Armory profile is private or hasn't been published yet (it updates after a logout).",
    id_mismatch: 'This name now belongs to a different Armory character.',
    pending: "Armory data hasn't been fetched yet — it refreshes hourly.",
};

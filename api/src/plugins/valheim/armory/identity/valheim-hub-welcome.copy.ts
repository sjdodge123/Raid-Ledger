/**
 * ROK-2362 #10 — the hub welcome copy for a Valheim server hub, owned by the
 * Valheim plugin and served through its claim provider. Moved verbatim from
 * core's `hub-welcome.constants.ts` (placeholder mockup REC wording from
 * ROK-1933); `valheim-hub-welcome.copy.spec.ts` pins it byte for byte.
 */
import { escapeHubName } from '../../../../discord-bot/services/discord-embed-event-body.helpers';
import type { HubWelcomeCopy } from '../../../plugin-host/extension-points';

export const VALHEIM_HUB_WELCOME_COPY: HubWelcomeCopy = {
  description: (hubName: string): string =>
    `This channel is linked to the **${escapeHubName(hubName)}** hub: who's online, the map, chests, the crafting planner and the play schedule, all in one place.`,
  claimHint:
    "Link Steam once on Raid Ledger and every character you play here is claimed for you. Or open the hub's Characters tab and pick yours.",
};

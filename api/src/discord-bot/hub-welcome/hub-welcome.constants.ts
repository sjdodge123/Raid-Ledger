import { escapeHubName } from '../services/discord-embed-event-body.helpers';

/**
 * ROK-1933 Part 4 — every string the hub welcome embed shows. PLACEHOLDER
 * copy from the approved mockup (`pending-approval/ROK-1933-claim-drive`);
 * the operator has not ruled on the wording, so it lives in this one block.
 *
 * ROK-1950 review: hub names are leader-renamable, so every description
 * passes the name through `escapeHubName` (no masked links, no mentions).
 * Embed titles render neither, so `title` keeps the raw name.
 */
export const HUB_WELCOME_COPY = {
  /** Author line. Also the scan marker for finding the bot's own welcome. */
  author: 'Raid Ledger',
  title: (hubName: string): string => `${hubName} on Raid Ledger`,
  /** Generic description; a hub kind may pass its own (see VALHEIM below). */
  description: (hubName: string): string =>
    `This channel is linked to the **${escapeHubName(hubName)}** hub on Raid Ledger.`,
  claimFieldName: 'Claim your character',
  newHereName: 'New here?',
  newHereValue: 'Sign in with Discord, then press Join on the hub.',
  openHubLabel: 'Open the hub',
  claimLabel: 'Claim your character',
  /** Audit-log reason on the pin. */
  pinReason: 'Raid Ledger hub welcome',
} as const;

/** Placeholder plugin copy for a Valheim server hub (mockup REC wording). */
export const HUB_WELCOME_VALHEIM_COPY = {
  description: (hubName: string): string =>
    `This channel is linked to the **${escapeHubName(hubName)}** hub: who's online, the map, chests, the crafting planner and the play schedule, all in one place.`,
  claimHint:
    "Link Steam once on Raid Ledger and every character you play here is claimed for you. Or open the hub's Characters tab and pick yours.",
} as const;

/** Hub page path; the claim button deep-links its Characters tab. */
export const HUB_WELCOME_PATHS = {
  hub: (hubId: number): string => `/hubs/${hubId}`,
  charactersHash: '#characters',
} as const;

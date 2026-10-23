/**
 * ROK-1933 L2 — the suggested-claim DM: copy, button ids and dedupe keys.
 *
 * PLACEHOLDER copy from `pending-approval/ROK-1933-claim-drive/mockup.html`
 * (the REC wording); the operator has not ruled Q2 yet, so every string the
 * player reads lives in `CLAIM_SUGGEST_COPY` and nowhere else.
 */

/** Button custom ids; the L3 listener routes on these prefixes. */
export const VALHEIM_CLAIM_BUTTON_IDS = {
  YES: 'vclaim:yes',
  NO: 'vclaim:no',
} as const;

/** The DM's player-facing strings (placeholder until Q2 is ruled). */
export const CLAIM_SUGGEST_COPY = {
  title: (name: string): string => `Is ${name} yours?`,
  lead: (name: string, hub: string): string =>
    `${name} is playing on ${hub} right now`,
  reasonName: ', and the name looks like yours.',
  reasonVoice: (hub: string): string =>
    `, while you're in the ${hub} voice channel.`,
  reasonBoth: ", while you're in voice, and the name looks like yours.",
  ask: "If it's your character, claim it to see its gear, skills and chests on Raid Ledger.",
  tip: 'Tip: link Steam once and every character you play is claimed automatically.',
  yes: "Yes, it's mine",
  no: 'Not me',
  openHub: 'Open the hub',
} as const;

const DAY_SECONDS = 24 * 60 * 60;
/** Per-user throttle (Q5) and per-character throttle TTL. */
export const CLAIM_SUGGEST_THROTTLE_TTL_SECONDS = DAY_SECONDS;

/** The dedupe keys (D8) — `NotificationDedupService` keys, no table. */
export const claimSuggestKeys = {
  /** Permanent: this user was asked about this character. */
  pair: (profileId: number, userId: number): string =>
    `valheim-claim-suggest:${profileId}:${userId}`,
  /** 24h: at most one claim DM per user per day, across characters. */
  user: (userId: number): string => `valheim-claim-suggest-user:${userId}`,
  /** 24h: one candidate asked per character per day; Not me frees it. */
  profile: (profileId: number): string =>
    `valheim-claim-suggest-profile:${profileId}`,
  /** Permanent: the user answered Not me (written by L3). */
  declined: (profileId: number, userId: number): string =>
    `valheim-claim-suggest-declined:${profileId}:${userId}`,
} as const;

/** Which signal picked the candidate — it chooses the reason line. */
export interface ClaimSignal {
  nameMatched: boolean;
  inVoice: boolean;
}

/** The DM inputs the copy needs. */
export interface ClaimSuggestCopyInput extends ClaimSignal {
  characterName: string;
  hubName: string;
}

/** The reason clause for the signal that matched. */
function reasonLine(input: ClaimSuggestCopyInput): string {
  if (input.nameMatched && input.inVoice) return CLAIM_SUGGEST_COPY.reasonBoth;
  if (input.nameMatched) return CLAIM_SUGGEST_COPY.reasonName;
  return CLAIM_SUGGEST_COPY.reasonVoice(input.hubName);
}

/**
 * The DM's title and body.
 *
 * @param input - Character, hub and the matching signal.
 * @returns The notification title and message.
 */
export function buildClaimSuggestText(input: ClaimSuggestCopyInput): {
  title: string;
  message: string;
} {
  const lead = CLAIM_SUGGEST_COPY.lead(input.characterName, input.hubName);
  return {
    title: CLAIM_SUGGEST_COPY.title(input.characterName),
    message: `${lead}${reasonLine(input)} ${CLAIM_SUGGEST_COPY.ask}\n\n${CLAIM_SUGGEST_COPY.tip}`,
  };
}

/** The hub's claim target (D4): the Characters tab. */
export function buildClaimHubUrl(clientUrl: string, guildId: number): string {
  return `${clientUrl}/hubs/${guildId}#characters`;
}

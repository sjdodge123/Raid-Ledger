/**
 * ROK-1933 — the claim DM's button ids and labels. They live on the
 * notifications side so the core embed builder never imports plugin code;
 * the Valheim plugin's copy re-exports them.
 */
export const VALHEIM_CLAIM_BUTTON_IDS = {
  YES: 'vclaim:yes',
  NO: 'vclaim:no',
} as const;

/** The DM's button labels. */
export const VALHEIM_CLAIM_BUTTON_LABELS = {
  yes: "Yes, it's mine",
  no: 'Not me',
  openHub: 'Open the hub',
} as const;

/** ROK-1957 — the `bg3` plugin's ids and tunables (ids live in the contract). */
export {
  BG3_GAME_SLUG,
  BG3_PLUGIN_ID,
  BG3_RETENTION_JOB_NAME,
  BG3_SAVE_CONTRACT_ID,
} from '@raid-ledger/contract';

/** D-8: a gap of at least this long between saves starts a new session. */
export const BG3_SESSION_GAP_MS = 4 * 3_600_000;
/** D-9: every save is kept this long, then one per session. */
export const BG3_RETENTION_DAYS = 90;

/** `Cache-Control` for every per-viewer bg3 read (hub data is membership-gated). */
export const BG3_NO_STORE = 'private, no-store';

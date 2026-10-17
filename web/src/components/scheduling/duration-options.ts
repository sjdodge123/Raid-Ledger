/**
 * Voting-window duration options for standalone polls (ROK-1192).
 * Kept in a constants-only module so `duration-picker.tsx` stays a
 * pure component file (react-refresh/only-export-components). ROK-1206.
 */

/** Duration options for the standalone poll picker (ROK-1192). */
export const DURATION_OPTIONS = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 72, label: '72 hours' },
  { hours: 168, label: '7 days' },
] as const;

/** Default voting window applied when the modal first opens. */
export const DEFAULT_DURATION_HOURS = 72;

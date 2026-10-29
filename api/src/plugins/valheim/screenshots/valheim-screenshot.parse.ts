/**
 * ROK-1941 (D5/D15): the Valheim screenshot mod's Discord post wording.
 * Pure — no Discord types, so the core listener's port and the backfill
 * job share one parser. The post text is free game text: never log it.
 */

const NAME = String.raw`\**(?<name>[^*\n]{1,64}?)\**`;

/** `<name> met their demise!` — a death picture. */
export const DEATH_POST_RE = new RegExp(
  String.raw`^${NAME} met their demise!(?:\s|$)`,
  'u',
);

/** `<name> captured this screenshot!` — a plain screenshot. */
export const SCREENSHOT_POST_RE = new RegExp(
  String.raw`^${NAME} captured this screenshot!(?:\s|$)`,
  'u',
);

/** The mod's capture filename `…_YYYY-MM-DD_HH-MM-SS.<ext>` (player-local). */
export const CAPTURE_FILENAME_RE =
  /_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(?:png|jpe?g|webp)$/i;

/** What a post's text says it is; `image` = unclassified. */
export type ValheimPostClassification =
  | { kind: 'death' | 'screenshot'; name: string }
  | { kind: 'image'; name: null };

/** The embed fields D5 falls back to when the message has no content. */
export interface PostEmbedText {
  description?: string | null;
  title?: string | null;
}

const UNCLASSIFIED: ValheimPostClassification = { kind: 'image', name: null };

/** D5: trimmed content, else the first embed's `description ?? title`. */
export function postText(
  content: string,
  embeds: readonly PostEmbedText[],
): string {
  const text = content.trim();
  if (text !== '') return text;
  const first = embeds[0];
  return (first?.description ?? first?.title ?? '').trim();
}

/** Classify a post's text; an empty or unmatched name is an `image`. */
export function classifyPost(text: string): ValheimPostClassification {
  const trimmed = text.trim();
  const death = DEATH_POST_RE.exec(trimmed)?.groups?.['name']?.trim();
  if (death) return { kind: 'death', name: death };
  const shot = SCREENSHOT_POST_RE.exec(trimmed)?.groups?.['name']?.trim();
  if (shot) return { kind: 'screenshot', name: shot };
  return UNCLASSIFIED;
}

/**
 * D15: the capture filename's `mm*60 + ss` — the timezone-independent part
 * of a player-local stamp (whole-hour offsets), used only as a tie-breaker.
 * Null when the name does not carry a valid stamp.
 */
export function captureSecondOfHour(filename: string): number | null {
  const match = CAPTURE_FILENAME_RE.exec(filename);
  const minutes = Number(match?.[5]);
  const seconds = Number(match?.[6]);
  if (!match || minutes > 59 || seconds > 59) return null;
  return minutes * 60 + seconds;
}

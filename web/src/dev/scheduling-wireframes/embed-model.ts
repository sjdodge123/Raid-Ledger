/**
 * Shape of a mocked Discord scheduling-poll embed — DEV-ONLY (ROK-1553).
 *
 * Both grammars (`embed-grammar-today.ts`, `embed-grammar-target.ts`) produce
 * this one model so the chrome in `discord-chrome.tsx` renders "today" and
 * "target" through exactly the same component tree — any difference the
 * operator sees is a difference in the *grammar*, never in the mock's markup.
 *
 * Nothing here talks to `api/src/discord-bot/**`. It is a faithful copy of
 * that grammar for a wireframe, not an import of it.
 */

/** Colours are the real `EMBED_COLORS` hexes, not app tokens. */
export const EMBED_COLOR = {
  /** announcing — cyan #38bdf8 (`CHROME_STATES.open`). */
  open: '#38bdf8',
  /** live — emerald #34d399 (`CHROME_STATES.locked_in`). */
  locked: '#34d399',
  /** done-context — slate #64748b (`CHROME_STATES.closed`). */
  closed: '#64748b',
  /** cancelled — red #ef4444. Target only; today has no cancelled state. */
  cancelled: '#ef4444',
} as const;

/** How one description line reads. Drives colour and weight, nothing else. */
export type EmbedTone = 'normal' | 'muted' | 'lead' | 'warn' | 'mine' | 'bad';

/** One rendered line of an embed description. */
export interface EmbedLine {
  id: string;
  text: string;
  tone?: EmbedTone;
}

/** One button in a mocked action row. */
export interface EmbedButton {
  id: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
}

/** The ephemeral ("Only you can see this") reply behind a vote button. */
export interface EphemeralModel {
  headline: string;
  lines: EmbedLine[];
  buttons: EmbedButton[];
}

/** Everything the chrome needs to draw one embed. */
export interface WfEmbedModel {
  /** Left colour bar; a real `EMBED_COLORS` hex. */
  color: string;
  /** Author line — the state-carrying row above the title. */
  authorLine: string;
  title: string;
  lines: EmbedLine[];
  /** Masked link rendered as the last description line. */
  link: { label: string; href: string } | null;
  footer: string;
  /** Absent on every "today" embed — ROK-1461 removed the button row. */
  actionRow: EmbedButton[] | null;
  /** Absent on every "today" embed — one shared message has no per-viewer state. */
  ephemeral: EphemeralModel | null;
}

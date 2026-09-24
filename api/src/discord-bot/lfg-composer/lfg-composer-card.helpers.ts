/**
 * ROK-1612 — the pinned card and the search modal.
 *
 * PURE builders: no database, no settings, no client. The pinned card is a
 * PUBLIC message, so since ROK-1685 its `View games ↗` is a press
 * (`LFG_COMPOSER_IDS.VIEW`), never a link: the handler answers the clicker
 * ephemerally with a link carrying THEIR OWN magic-link token, and the card
 * itself holds no URL a stranger could reuse. An unconfigured deployment drops
 * that press rather than the entire card — there would be nothing to link to.
 * The ephemeral replies keep a Link button, built from a finished URL by
 * `buildViewGamesLinkButton`; `fitGamesLink` fits the searched term into a
 * minted link under Discord's cap without touching the token.
 *
 * The modal carries exactly one text input. That asymmetry is forced, not
 * chosen: `LabelBuilder` appears 0 times in the installed discord.js typings,
 * so a select inside a modal is not buildable, and `ModalSubmitInteraction` has
 * no `showModal`, so a submit can never open another modal. Every reopen
 * therefore happens from a BUTTON — which is what makes `Back` possible at all.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  LFG_COMPOSER_COPY,
  LFG_COMPOSER_IDS,
  LFG_COMPOSER_TERM_MAX,
} from './lfg-composer.constants';
import { normalizeComposerTerm } from './lfg-composer-state.helpers';

/**
 * Discord's cap on a Link button's `url`. A longer one fails the WHOLE message
 * (API error 50035), so a reply carrying it would never render. The /games
 * page's own `?q=` cap (the web's `MAX_SEARCH_QUERY_LENGTH`, 100) needs no
 * enforcement here: `normalizeComposerTerm` already stops a term at 64.
 */
export const DISCORD_LINK_URL_MAX = 512;

/**
 * `url?q=<term>`, shortened to fit Discord's link cap.
 *
 * `URLSearchParams` turns one 3-byte UTF-8 character into 9 URL characters,
 * so 64 of them overflow the cap on an ordinary base. The term loses one code
 * point at a time (never half a surrogate pair) until the URL fits; a base too
 * long to fit even one links plain /games.
 *
 * @param reserve - Characters the caller appends afterwards (a `#token=…`
 *   fragment); the cap has to leave room for them.
 */
function withSearchTerm(url: string, term: string, reserve = 0): string {
  const max = DISCORD_LINK_URL_MAX - reserve;
  const points = Array.from(term);
  while (points.length > 0) {
    const q = new URLSearchParams({ q: points.join('') }).toString();
    const linked = `${url}?${q}`;
    if (linked.length <= max) return linked;
    points.pop();
  }
  return url;
}

/**
 * The games page a `View games ↗` button opens, or null when unconfigured.
 *
 * With a searched term the link carries `?q=<term>` so /games opens with the
 * search box already filled (ROK-1658 operator note) — the term goes through
 * `URLSearchParams`, so spaces, `&`, `#` and unicode arrive intact, cut short
 * only where the full term would push the URL past `DISCORD_LINK_URL_MAX`.
 *
 * @param clientUrl - Deployment client URL.
 * @param term - What the player searched; absent or blank links plain /games.
 * @returns The URL, or null when the deployment has no web URL.
 */
export function gamesPageUrl(
  clientUrl?: string | null,
  term?: string | null,
): string | null {
  const base = clientUrl?.trim();
  if (!base) return null;
  const url = `${base.replace(/\/+$/, '')}/games`;
  return withSearchTerm(url, normalizeComposerTerm(term ?? ''));
}

/**
 * A minted `/games#token=…` magic link with `?q=<term>` fitted in (ROK-1685).
 *
 * The link splits at its FIRST `#`. Everything from there is the token
 * fragment: it is kept byte for byte and reserved out of the cap before the
 * term is placed, so only the term gives way. The term is encoded, so a `#` or
 * `&` typed into it can never pose as the fragment. `generateLink` builds the
 * link from a bare path, so there is no query for `?q=` to collide with.
 *
 * @param link - A finished link from `MagicLinkService.generateLink`.
 * @param term - What the player searched; blank hands back the bare link.
 * @returns The fitted link, or null when even the bare link is over the cap —
 *   Discord would reject the whole message rather than the one button.
 */
export function fitGamesLink(link: string, term: string): string | null {
  if (link.length > DISCORD_LINK_URL_MAX) return null;
  const hash = link.indexOf('#');
  const base = hash < 0 ? link : link.slice(0, hash);
  const fragment = hash < 0 ? '' : link.slice(hash);
  const fitted = withSearchTerm(
    base,
    normalizeComposerTerm(term),
    fragment.length,
  );
  return `${fitted}${fragment}`;
}

/**
 * The ephemeral replies' `View games ↗` link button, from a finished URL.
 *
 * @param url - The link to open (`gamesPageUrl`'s or `fitGamesLink`'s), or
 *   null when there is none.
 * @returns The button, or null — callers spread the result so an unconfigured
 *   instance simply renders one fewer control.
 */
export function buildViewGamesLinkButton(
  url: string | null,
): ButtonBuilder | null {
  if (!url) return null;
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON)
    .setURL(url);
}

/** What the composer card renders as. */
export interface LfgComposerCard {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * The pinned composer card.
 *
 * Title only — the operator struck every line of subtitle and every mention of
 * not having to leave the channel.
 *
 * @param clientUrl - Deployment client URL; absent drops `View games ↗`,
 *   whose handler would have nothing to link to.
 * @returns Content and one button row.
 */
export function buildComposerCard(clientUrl?: string | null): LfgComposerCard {
  const post = new ButtonBuilder()
    .setCustomId(LFG_COMPOSER_IDS.OPEN)
    .setStyle(ButtonStyle.Primary)
    .setLabel(LFG_COMPOSER_COPY.POST_BUTTON);
  const view = new ButtonBuilder()
    .setCustomId(LFG_COMPOSER_IDS.VIEW)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON);
  const buttons = clientUrl?.trim() ? [post, view] : [post];
  return {
    content: LFG_COMPOSER_COPY.CARD_TITLE,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  };
}

/**
 * The search modal, optionally prefilled.
 *
 * AC8/AC9 — `Back` and `Try again` both reopen it through here with the term
 * they carried, so a typo is EDITED rather than retyped. The input's max length
 * matches the custom-id term budget: anything typable can always be handed back.
 *
 * @param prefill - What to put in the box; empty opens it blank.
 * @returns A modal ready for `interaction.showModal`.
 */
export function buildComposerModal(prefill = ''): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(LFG_COMPOSER_IDS.INPUT)
    .setLabel(LFG_COMPOSER_COPY.MODAL_INPUT_LABEL)
    .setPlaceholder(LFG_COMPOSER_COPY.MODAL_PLACEHOLDER)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(LFG_COMPOSER_TERM_MAX);
  const value = normalizeComposerTerm(prefill);
  if (value) input.setValue(value);
  return new ModalBuilder()
    .setCustomId(LFG_COMPOSER_IDS.MODAL)
    .setTitle(LFG_COMPOSER_COPY.MODAL_TITLE)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
}

/** Anything that serialises to a Discord action row — a builder or a received row. */
interface JsonRow {
  toJSON(): unknown;
}

/** The fields of each button that change what a member sees or presses. */
function rowSignature(rows: readonly JsonRow[] | undefined): string {
  return JSON.stringify(
    (rows ?? []).map((row) => {
      const json = row.toJSON() as { components?: Record<string, unknown>[] };
      return (json.components ?? []).map((c) => [
        c.type,
        c.style,
        c.label,
        c.custom_id ?? c.url,
        c.disabled ?? false,
      ]);
    }),
  );
}

/**
 * True when a message already carries these rows, so an edit would be a
 * no-op round-trip to Discord.
 *
 * @param current - The rows on the message now (received from Discord).
 * @param next - The rows about to be written (builders).
 */
export function sameComponents(
  current: readonly JsonRow[] | undefined,
  next: readonly JsonRow[],
): boolean {
  return rowSignature(current) === rowSignature(next);
}

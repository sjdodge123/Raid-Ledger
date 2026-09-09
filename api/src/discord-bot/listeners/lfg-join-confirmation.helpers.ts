/**
 * What a Join press gets told back — ROK-1455 walk feedback 1 & 2.
 *
 * The operator pressed `Join the group` on an invite DM and got back
 * `That's 2 now — Open group ↗`, which says nothing about WHAT they joined or
 * WHEN it plays. Both press surfaces (the board's `+1` and the DM's Join) share
 * `LfgJoinListener.confirmation()`, and the operator ruled that ONE consistent
 * reply beats two divergent ones — so the board's reply changes with it.
 *
 * Two rules the copy exists to honour:
 *
 *  1. **The horizon comes from the JOINER'S OWN hand**, `result.body` — which
 *     IS the intent just raised (or, on the idempotent repeat, the surviving
 *     one). NOT from the group aggregate: a week-hand joiner in a now-group
 *     must not be told "right now until …", because their hand does not expire
 *     then. (`result.body.group` is an `LfgGroupSummaryDto` and carries no
 *     `ownIntent` field — the caller's own row is the response root.)
 *  2. **The time is Discord timestamp markup**, so it renders in the reader's
 *     own timezone. A server-formatted clock string is wrong for most readers;
 *     the invite DM card already does this and this matches it.
 */
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { LfgIntentResponseDto } from '@raid-ledger/contract';
import { lfgViewGroupComponents } from '../embeds/lfg-view-group-button.helpers';

/** The ephemeral reply body: copy plus the `View the group` row. */
export interface LfgJoinConfirmation {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** Structurally `CreateIntentResult`, without importing the service. */
export interface LfgJoinConfirmationInput {
  /** False is the idempotent repeat press, not a failure (E10). */
  created: boolean;
  body: LfgIntentResponseDto;
}

/** An ISO instant, or null when it is absent or unparseable. */
function readInstant(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The `, right now until <t:…:t>` / `, this week` clause for the joiner's hand.
 *
 * Degrades rather than lying: an unknown urgency yields no clause at all, and a
 * now-hand whose expiry is missing or unparseable yields `, right now` with no
 * time — never an empty or `Invalid Date` timestamp.
 *
 * @param intent - The joiner's own intent, or null when it is unavailable.
 */
export function lfgJoinHorizonClause(
  intent: Pick<LfgIntentResponseDto, 'urgency' | 'expiresAt'> | null | undefined,
): string {
  if (!intent) return '';
  if (intent.urgency === 'week') return ', this week';
  if (intent.urgency !== 'now') return '';
  const lapsesAt = readInstant(intent.expiresAt);
  if (!lapsesAt) return ', right now';
  return `, right now until <t:${Math.floor(lapsesAt.getTime() / 1000)}:t>`;
}

/**
 * Build the whole ephemeral reply for one Join press.
 *
 * @param result - What `LfgService.createIntent` settled on.
 * @param clientUrl - Configured client base URL, or null when unset — the
 *   `View the group` button is omitted entirely rather than pointing nowhere.
 * @returns Content plus components, ready for `interaction.editReply`.
 */
export function buildLfgJoinConfirmation(
  result: LfgJoinConfirmationInput,
  clientUrl: string | null | undefined,
): LfgJoinConfirmation {
  const group = result.body?.group;
  const lead = result.created ? "You're in" : "You're already in";
  const horizon = lfgJoinHorizonClause(result.body);
  const tail = group?.isViable ? " — that's enough to play." : '.';
  return {
    content: `${lead} — ${group?.gameName ?? 'the group'}${horizon}. ${group?.activeCount ?? 0} looking${tail}`,
    components: lfgViewGroupComponents(
      clientUrl && group?.gameSlug
        ? `${clientUrl}/lfg/${group.gameSlug}`
        : null,
    ),
  };
}

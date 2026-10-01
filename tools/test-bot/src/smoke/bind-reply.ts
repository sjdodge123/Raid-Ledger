/**
 * Pure checks on a /bind reply captured by the /admin/test/slash-command
 * harness.
 *
 * /bind refuses through editReply without throwing (game or series not
 * found, no linked account, missing permission, a rejected duplicate, the
 * multi-monitor confirm prompt, or the handler's own catch), so the harness
 * answers 200 either way. A smoke test that ignores the reply only learns
 * about a refusal later, as an empty bindings list. assertBindSucceeded turns
 * the refusal into the failure message instead.
 *
 * Kept free of discord.js / voice imports so the unit-spec gate can run it.
 */

/** One serialized embed as the slash-command harness returns it. */
export interface BindReplyEmbed {
  title?: string;
  description?: string;
  author?: { name?: string };
}

/** The slash-command harness response for /bind. */
export interface BindReply {
  content?: string;
  embeds?: BindReplyEmbed[];
}

/**
 * Author line of every /bind success embed: the API's
 * COMMAND_REPLY_AUTHORS.BIND_SAVED ('⚙ BINDING SAVED') and
 * EVENT_BIND_SAVED ('⚙ EVENT BINDING SAVED').
 */
const BIND_SAVED_AUTHOR = /BINDING SAVED/;

/** True when the reply carries a /bind success embed. */
export function isBindSuccess(res: BindReply | null | undefined): boolean {
  return (res?.embeds ?? []).some((e) =>
    BIND_SAVED_AUTHOR.test(e.author?.name ?? ''),
  );
}

/** The text a refused /bind showed the user, or the raw reply if it had none. */
export function bindRefusalText(res: BindReply | null | undefined): string {
  if (res?.content) return res.content;
  const embeds = res?.embeds ?? [];
  const described = embeds.find((e) => e.description)?.description;
  if (described) return described;
  if (embeds[0]?.title) return embeds[0].title;
  return `no reply text (raw reply: ${JSON.stringify(res ?? null)})`;
}

/** Throw `/bind <label> refused: <text>` unless the reply is a success embed. */
export function assertBindSucceeded(
  res: BindReply | null | undefined,
  label: string,
): void {
  if (isBindSuccess(res)) return;
  throw new Error(`/bind ${label} refused: ${bindRefusalText(res)}`);
}

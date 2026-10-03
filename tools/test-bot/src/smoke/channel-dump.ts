/**
 * Channel dumps for a timed-out embed poll.
 *
 * `pollForEmbed timed out ... on channel X` reads the same whether no embed
 * was posted or an embed was posted that the predicate rejected (ROK-1390).
 * `withChannelDump` appends each channel's last messages to the timeout
 * text so the next failure says which: author tag, each embed's title,
 * author line and footer, and the start of the content.
 *
 * Kept free of discord.js imports (the reader is injected) so the unit-spec
 * gate can run it.
 */
import type { SimpleMessage } from '../helpers/messages.js';

/** Messages dumped per channel. */
export const DUMP_COUNT = 10;

/** Content characters kept per dumped message. */
const CONTENT_CHARS = 80;

/** Reads a channel's last `count` messages, oldest first. */
export type DumpReader = (
  channelId: string,
  count: number,
) => Promise<SimpleMessage[]>;

/** A channel to dump, with the role it plays in the test. */
export interface DumpTarget {
  label: string;
  channelId: string;
}

/** `"text"`, or `null` when the field is absent. */
function quote(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

/** One dump line: author tag, every embed's title/author/footer, content head. */
export function describeMessage(m: SimpleMessage): string {
  const embeds = m.embeds.length
    ? m.embeds
        .map(
          (e) =>
            `embed title=${quote(e.title)} author=${quote(e.author)} footer=${quote(e.footer)}`,
        )
        .join(' | ')
    : 'no embed';
  const content = quote(m.content.slice(0, CONTENT_CHARS));
  return `${m.authorTag} | ${embeds} | content=${content}`;
}

/** Targets sharing a channel id collapse into one, labels joined. */
function mergeTargets(targets: readonly DumpTarget[]): DumpTarget[] {
  const byId = new Map<string, string[]>();
  for (const t of targets) {
    byId.set(t.channelId, [...(byId.get(t.channelId) ?? []), t.label]);
  }
  return [...byId].map(([channelId, labels]) => ({
    channelId,
    label: labels.join(' + '),
  }));
}

async function dumpOne(t: DumpTarget, read: DumpReader): Promise<string> {
  const head = `  ${t.label} (channel ${t.channelId})`;
  let msgs: SimpleMessage[];
  try {
    msgs = (await read(t.channelId, DUMP_COUNT)).slice(-DUMP_COUNT);
  } catch (err) {
    return `${head}: read failed (${(err as Error).message})`;
  }
  if (msgs.length === 0) return `${head}: no messages`;
  const lines = msgs.map((m) => `    ${describeMessage(m)}`);
  return [`${head}, last ${msgs.length}, oldest first:`, ...lines].join('\n');
}

/** Each target's last messages, one section per distinct channel. */
export async function dumpChannels(
  targets: readonly DumpTarget[],
  read: DumpReader,
): Promise<string> {
  const sections = await Promise.all(
    mergeTargets(targets).map((t) => dumpOne(t, read)),
  );
  return sections.join('\n');
}

/**
 * Run `poll`. When it times out, throw `<context>: <timeout text>` followed
 * by the targets' last messages. Any other error propagates unchanged.
 */
export async function withChannelDump<T>(
  poll: () => Promise<T>,
  context: string,
  targets: readonly DumpTarget[],
  read: DumpReader,
): Promise<T> {
  try {
    return await poll();
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (!/timed out/.test(message)) throw err;
    const dump = await dumpChannels(targets, read);
    throw new Error(`${context}: ${message}\n${dump}`);
  }
}

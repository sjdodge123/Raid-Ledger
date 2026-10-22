/**
 * ROK-1911 (epic ROK-1905): the `{id, name}` view of `events.content_instances`
 * that hub event cards carry (`GuildEventCardSchema.contentInstances`), so a
 * widget can tell which upcoming events have a dungeon/raid. Pure; no DB.
 */

/** Contract bounds (`guild-raids.schema.ts`). */
const MAX_CARDS = 20;
const MAX_NAME = 200;

/** One content instance as a hub card shows it. */
export interface ContentInstanceCard {
  id: number;
  name: string;
}

/**
 * One stored entry → a card. Mirrors `contentInstanceId` in
 * `event-forever-progress.helpers.ts`: a numeric or numeric-string `id`, or
 * the legacy `instanceId` key. Entries without a string name are dropped.
 */
function toCard(entry: unknown): ContentInstanceCard[] {
  if (!entry || typeof entry !== 'object') return [];
  const { id, instanceId, name } = entry as {
    id?: unknown;
    instanceId?: unknown;
    name?: unknown;
  };
  const raw = id ?? instanceId;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || typeof name !== 'string') return [];
  return [{ id: n, name: name.slice(0, MAX_NAME) }];
}

/**
 * Cards for an event's stored `content_instances` jsonb (≤20).
 * @param content the raw column value (anything; junk is skipped)
 */
export function toContentInstanceCards(
  content: unknown,
): ContentInstanceCard[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap(toCard).slice(0, MAX_CARDS);
}

/**
 * Teardown for smoke tests that bind channels to an event series via /bind.
 *
 * /bind returns no binding id, so a test only learns its ids from the admin
 * bindings list. Tests that read that list after BOTH binds leak the first
 * binding whenever the second bind throws: the list is never read and the
 * finally block has nothing to delete. Sweeping by recurrenceGroupId in the
 * finally block covers every exit path, with no id bookkeeping.
 *
 * Kept free of discord.js / voice imports so the unit-spec gate can run it.
 */

/** The admin-API calls the sweep needs; the smoke ApiClient satisfies it. */
export interface BindingSweepApi {
  get<T = unknown>(path: string): Promise<T>;
  delete(path: string): Promise<void>;
}

/** The binding fields the sweep reads. */
export interface SeriesBindingRow {
  id: string;
  recurrenceGroupId?: string | null;
}

type BindingsResponse = SeriesBindingRow[] | { data?: SeriesBindingRow[] };

/** All binding rows, or [] (with a warning) when the list call fails. */
async function listRows(api: BindingSweepApi): Promise<SeriesBindingRow[]> {
  try {
    const res = await api.get<BindingsResponse>('/admin/discord/bindings');
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch (err) {
    console.warn(
      `  [cleanup] could not list bindings: ${(err as Error).message}`,
    );
    return [];
  }
}

/**
 * Delete every binding of the series. Never throws, so a cleanup failure
 * cannot mask the test's own error. Returns the ids it tried to delete.
 */
export async function deleteSeriesBindings(
  api: BindingSweepApi,
  recurrenceGroupId: string,
): Promise<string[]> {
  const ids = (await listRows(api))
    .filter((r) => r.recurrenceGroupId === recurrenceGroupId)
    .map((r) => r.id);
  for (const id of ids) {
    await api.delete(`/admin/discord/bindings/${id}`).catch(() => {});
  }
  return ids;
}

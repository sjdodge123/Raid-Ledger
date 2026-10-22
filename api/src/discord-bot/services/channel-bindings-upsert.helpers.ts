/**
 * ROK-1428 — `ChannelBindingsService.upsertBinding`'s two writes, split out
 * for the file-size limit. Both take the handle to run on (the pool, or the
 * channel lifecycle's reconcile-lock tx) and write optional lifecycle
 * ownership in the same statement as the row (Codex r3: atomic ownership).
 */
import { eq } from 'drizzle-orm';
import type {
  BindingPurpose,
  ChannelBindingConfig,
  ChannelType,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { defined } from '../../common/defined.helpers';
import type { LifecycleDb } from '../channel-lifecycle/channel-lifecycle.store';
import { mappingConflicts } from './channel-bindings-uniqueness.helpers';
import type { BindingRecord } from './channel-bindings.service';

export interface UpsertBindingOpts {
  guildId: string;
  channelId: string;
  channelType: ChannelType;
  bindingPurpose: BindingPurpose;
  gameId: number | null;
  config?: ChannelBindingConfig;
  recurrenceGroupId?: string | null;
  lifecycle?: BindLifecycle;
}

/** ROK-1428 (Codex r3): lifecycle ownership written in the binding's own insert. */
export interface BindLifecycle {
  autoManaged: boolean;
  lifecycleState: 'active' | 'archived';
}

/** `bind()` extras for the channel lifecycle; other callers pass none. */
export interface BindOptions {
  /** Run on this handle (the reconcile lock's tx) instead of the pool. */
  db?: LifecycleDb;
  /** Stamp lifecycle ownership atomically with the row. */
  lifecycle?: BindLifecycle;
}

/** UPDATE branch: routing + optional config/lifecycle on an existing row. */
export async function updateBindingRow(
  db: LifecycleDb,
  id: string,
  opts: UpsertBindingOpts,
): Promise<BindingRecord> {
  const [result] = await mappingConflicts(() =>
    db
      .update(schema.channelBindings)
      .set({
        channelType: opts.channelType,
        bindingPurpose: opts.bindingPurpose,
        // ROK-1462: omit the column entirely when the caller supplied no
        // config, so the stored tuning survives. `/bind` re-binds with no
        // config at all; coercing that to `{}` wiped autoClose /
        // minPlayers / gracePeriod set from the admin form. An explicit
        // `{}` still means "clear it" and IS written.
        ...(opts.config !== undefined && { config: opts.config }),
        ...opts.lifecycle,
        updatedAt: new Date(),
      })
      .where(eq(schema.channelBindings.id, id))
      .returning(),
  );
  return defined(result, 'updated channel binding');
}

/** INSERT branch: a new row (config defaults to `{}`). */
export async function insertBindingRow(
  db: LifecycleDb,
  opts: UpsertBindingOpts,
): Promise<BindingRecord> {
  const [result] = await mappingConflicts(() =>
    db
      .insert(schema.channelBindings)
      .values({
        guildId: opts.guildId,
        channelId: opts.channelId,
        channelType: opts.channelType,
        bindingPurpose: opts.bindingPurpose,
        gameId: opts.gameId,
        recurrenceGroupId: opts.recurrenceGroupId ?? null,
        config: opts.config ?? {},
        ...opts.lifecycle,
      })
      .returning(),
  );
  return defined(result, 'inserted channel binding');
}

import type { GuildKind } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { hubNameKey } from './community/community-proposals.queries';
import { PROPOSAL_ERRORS } from './community/community-proposals.service';
import { HUB_NOT_FOUND } from './hub-hidden.helpers';

/**
 * ROK-1950 D3/D4 — the pure per-kind write rules of a hub rename. No I/O:
 * the service loads the row and the source name, then applies the plan.
 */

/** The hub fields a rename reads. */
export interface RenameRow {
  kind: GuildKind;
  name: string;
  nameOverridden: boolean;
  status: schema.GuildSelect['status'];
}

/** The columns a rename writes. `nameOverridden` only on server hubs. */
export interface RenameSet {
  name: string;
  nameKey: string;
  nameOverridden?: boolean;
}

/** A plan to apply, or the HTTP error to throw. */
export type RenamePlan =
  | { ok: true; set: RenameSet; from: string; to: string; reset: boolean }
  | { ok: false; status: 400 | 404 | 409; message: string };

/** The rename route's error messages (shared with specs and the web copy). */
export const RENAME_ERRORS = {
  nameTaken: PROPOSAL_ERRORS.nameTaken,
  communityReset: "A community hub's name can't be cleared",
  serverGone:
    "This hub's server is gone, so there is no server name to go back to",
  wowRefused: 'WoW guild names come from the game',
} as const;

const SOURCE_MAX = 64;

/** The plan for a hub, a new name (null = reset) and its source name. */
export function planRename(
  row: RenameRow,
  name: string | null,
  sourceName: string | null,
): RenamePlan {
  if (row.kind === 'wow_guild') return fail(409, RENAME_ERRORS.wowRefused);
  if (row.kind === 'game_server') return planServer(row, name, sourceName);
  if (row.status !== 'active') return fail(404, HUB_NOT_FOUND);
  if (name === null) return fail(400, RENAME_ERRORS.communityReset);
  return ok(row, { name, nameKey: hubNameKey(name) }, false);
}

/** D4 server hub: override, or reset (null / exactly the server name). */
function planServer(
  row: RenameRow,
  name: string | null,
  sourceName: string | null,
): RenamePlan {
  const source = sourceName === null ? null : sourceName.slice(0, SOURCE_MAX);
  if (name !== null && name !== source) {
    return ok(
      row,
      { name, nameKey: hubNameKey(name), nameOverridden: true },
      false,
    );
  }
  if (source === null) return fail(409, RENAME_ERRORS.serverGone);
  const set = {
    name: source,
    nameKey: hubNameKey(source),
    nameOverridden: false,
  };
  return ok(row, set, true);
}

function ok(row: RenameRow, set: RenameSet, reset: boolean): RenamePlan {
  return { ok: true, set, from: row.name, to: set.name, reset };
}

function fail(status: 400 | 404 | 409, message: string): RenamePlan {
  return { ok: false, status, message };
}

/** True when the write changes the name (case counts) or the override flag. */
export function isRenameChange(row: RenameRow, set: RenameSet): boolean {
  if (row.name !== set.name) return true;
  return (
    set.nameOverridden !== undefined &&
    set.nameOverridden !== row.nameOverridden
  );
}

/**
 * ROK-1789 (S5 part A) — pure helpers for guild recruitment: storage
 * normalising, stored-jsonb parsing, the column patch and row → view.
 * The headline `state` is derived by `recruitmentHeadline`, never stored.
 */
import {
  GuildRecruitmentSchema,
  recruitmentHeadline,
  type GuildRecruitment,
  type GuildRecruitWanted,
  type GuildRecruitmentView,
} from '@raid-ledger/contract';

/** `findRecruitmentRow`'s row; `recruitment` is the raw stored jsonb. */
export interface RecruitmentRow {
  recruitment: unknown;
  updatedAt: Date | null;
  /** The last editor's username; null when unknown or deleted. */
  updatedBy: string | null;
}

/** The `guild_profiles` columns a recruitment PUT / DELETE writes. */
export interface RecruitmentPatch {
  recruitment: GuildRecruitment | null;
  recruitmentUpdatedAt: Date | null;
  recruitmentUpdatedBy: number | null;
  updatedAt: Date;
}

function normaliseWanted(w: GuildRecruitWanted): GuildRecruitWanted {
  const note = w.note?.trim();
  return {
    className: w.className,
    role: w.role,
    state: w.state,
    ...(note ? { note } : {}),
  };
}

/**
 * Canonicalise a contract-validated body for storage: trim notes, drop a
 * blank note, trim the URL. Switch, row order and row states are kept.
 */
export function normaliseRecruitment(
  input: GuildRecruitment,
): GuildRecruitment {
  return {
    recruiting: input.recruiting,
    wanted: input.wanted.map(normaliseWanted),
    applyUrl: input.applyUrl === null ? null : input.applyUrl.trim(),
  };
}

/** Read the stored jsonb; null, malformed or an old shape all read as unset. */
export function parseStoredRecruitment(
  value: unknown,
): GuildRecruitment | null {
  const parsed = GuildRecruitmentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Column set for a save (`value`) or a clear (`null` → all three NULL). */
export function buildRecruitmentPatch(
  value: GuildRecruitment | null,
  userId: number,
  now: Date,
): RecruitmentPatch {
  const set = value !== null;
  return {
    recruitment: value,
    recruitmentUpdatedAt: set ? now : null,
    recruitmentUpdatedBy: set ? userId : null,
    updatedAt: now,
  };
}

/** Row (null = no profile row) → the GET/PUT response. Unset ⇒ all null. */
export function toRecruitmentView(
  row: RecruitmentRow | null,
  canEdit: boolean,
): GuildRecruitmentView {
  const recruitment = parseStoredRecruitment(row?.recruitment ?? null);
  const viewer = { canEdit };
  if (recruitment === null || row === null) {
    return {
      recruitment: null,
      state: null,
      updatedAt: null,
      updatedBy: null,
      viewer,
    };
  }
  return {
    recruitment,
    state: recruitmentHeadline(recruitment),
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
    viewer,
  };
}

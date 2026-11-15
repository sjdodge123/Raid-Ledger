import { Int4IdPipe } from '../../../common/pipes/int4-id.pipe';

/**
 * ROK-1835 path-id pipe for the armory routes: a positive int4, else 400
 * 'Invalid id'. `ParseIntPipe` let `0`/negatives through (→ 404) and ids above
 * int4 reach Postgres (22003 → 500). Same rule as the core `Int4IdPipe`.
 */
export class ArmoryIdPipe extends Int4IdPipe {}

/** Shared instance for `@Param('id', armoryIdPipe)`. */
export const armoryIdPipe = new ArmoryIdPipe();

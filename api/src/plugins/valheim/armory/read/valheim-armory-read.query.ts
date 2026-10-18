/**
 * ROK-1835 L4 — query-string parsing for the armory list routes. Pages are
 * 1-based; `pageSize` is capped at 100 (out-of-range → 400).
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Largest page the list routes return. */
export const ARMORY_PAGE_SIZE_MAX = 100;
/** Page size when `pageSize` is omitted. */
export const ARMORY_PAGE_SIZE_DEFAULT = 50;

const intParam = z.coerce.number().int();

const ListQuerySchema = z.object({
  serverId: intParam.positive().optional(),
  page: intParam.min(1).default(1),
  pageSize: intParam
    .min(1)
    .max(ARMORY_PAGE_SIZE_MAX)
    .default(ARMORY_PAGE_SIZE_DEFAULT),
  unclaimed: z.enum(['true', 'false']).optional(),
});

/** Parsed list query: optional server filter + a limit/offset window. */
export interface ArmoryListQuery {
  serverId?: number | undefined;
  unclaimed: boolean;
  limit: number;
  offset: number;
}

/** Parse `serverId`, `page`, `pageSize`, `unclaimed`; 400 when invalid. */
export function parseArmoryListQuery(query: unknown): ArmoryListQuery {
  const parsed = ListQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw new BadRequestException('Invalid query');
  const { serverId, page, pageSize, unclaimed } = parsed.data;
  return {
    serverId,
    unclaimed: unclaimed === 'true',
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

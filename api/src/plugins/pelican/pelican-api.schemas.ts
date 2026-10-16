import { z } from 'zod';

/**
 * Pelican client-API response shapes (upstream, not our wire format).
 *
 * Verified against pelican-dev/panel @ b41ad3e5: every item is wrapped as
 * `{ object, attributes }` and a collection as `{ object: 'list', data,
 * meta? }` with `meta.pagination` on paginated lists
 * (`app/Data/Api/Envelope.php`, `app/Data/Api/PanelResponse.php`).
 *
 * Only fields we use are declared; `z.object` strips unknown keys so an
 * additive upstream release never breaks a parse (ROK-121 D6).
 */

const item = <T extends z.ZodType>(object: string, attributes: T) =>
  z.object({ object: z.literal(object), attributes });

const PaginationSchema = z.object({
  total: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  per_page: z.number().int().nonnegative(),
  current_page: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
});

/** `app/Data/Api/Client/ServerData.php` (subset). */
const ServerAttributesSchema = z.object({
  uuid: z.string(),
  identifier: z.string(),
  name: z.string(),
});
export type PelicanServer = z.infer<typeof ServerAttributesSchema>;

/** `GET /api/client` → paginated `server` list. */
export const PelicanServerPageSchema = z
  .object({
    object: z.literal('list'),
    data: z.array(item('server', ServerAttributesSchema)),
    meta: z.object({ pagination: PaginationSchema }),
  })
  .transform((r) => ({
    servers: r.data.map((d) => d.attributes),
    pagination: r.meta.pagination,
  }));
export type PelicanServerPage = z.output<typeof PelicanServerPageSchema>;

/** `app/Data/Api/Client/StatsData.php`. */
export const PelicanStatsSchema = item(
  'stats',
  z.object({
    current_state: z.string(),
    is_suspended: z.boolean(),
    resources: z.object({
      memory_bytes: z.number(),
      cpu_absolute: z.number(),
      disk_bytes: z.number(),
      network_rx_bytes: z.number(),
      network_tx_bytes: z.number(),
      uptime: z.number(),
    }),
  }),
).transform((r) => r.attributes);
export type PelicanStats = z.output<typeof PelicanStatsSchema>;

/** `app/Data/Api/Client/TaskData.php`. `payload` is never logged. */
const TaskAttributesSchema = z.object({
  id: z.number().int(),
  sequence_id: z.number().int(),
  action: z.string(),
  payload: z.string().nullable(),
  // Per-task delay; the panel caps it at 900 s. Out of range = bad_response
  // (rows kept) rather than a CHECK violation mid-replace (ROK-1773 D6).
  time_offset: z.number().int().min(0).max(900),
  is_queued: z.boolean(),
  continue_on_failure: z.boolean(),
});
export type PelicanTask = z.infer<typeof TaskAttributesSchema>;

/** `app/Data/Api/Client/ScheduleData.php`; `tasks` is a default include. */
const ScheduleAttributesSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  cron: z.object({
    day_of_week: z.string(),
    day_of_month: z.string(),
    month: z.string(),
    hour: z.string(),
    minute: z.string(),
  }),
  is_active: z.boolean(),
  is_processing: z.boolean(),
  only_when_online: z.boolean(),
  last_run_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  relationships: z
    .object({
      tasks: z
        .object({ data: z.array(item('schedule_task', TaskAttributesSchema)) })
        .optional(),
    })
    .optional(),
});

/** `GET /api/client/servers/{server}/schedules` → `server_schedule` list. */
export const PelicanScheduleListSchema = z
  .object({
    object: z.literal('list'),
    data: z.array(item('server_schedule', ScheduleAttributesSchema)),
  })
  .transform((r) =>
    r.data.map(({ attributes: { relationships, ...rest } }) => ({
      ...rest,
      tasks: relationships?.tasks?.data.map((t) => t.attributes) ?? [],
    })),
  );
export type PelicanSchedule = z.output<
  typeof PelicanScheduleListSchema
>[number];

/**
 * `GET /api/client/servers/{server}/websocket` (`WebsocketController.php`):
 * `{ data: { token, socket } }`. `token` is a 10-minute JWT and `socket`
 * the Wings URL (`wss://<node>/api/servers/<uuid>/ws`). Neither is logged.
 */
export const PelicanWebsocketCredentialsSchema = z
  .object({
    data: z.object({
      token: z.string().min(1),
      socket: z
        .string()
        .url()
        .refine((u) => /^wss?:\/\//i.test(u), 'socket must be ws(s)://'),
    }),
  })
  .transform((r) => r.data);
export type PelicanWebsocketCredentials = z.output<
  typeof PelicanWebsocketCredentialsSchema
>;

/**
 * Laravel error body (`app/Exceptions/Handler.php`):
 * `{ errors: [{ code, status, detail }] }`. Read only to classify a 403;
 * the detail is never echoed or logged.
 */
export const PelicanErrorBodySchema = z.object({
  errors: z.array(
    z.object({ code: z.string().optional(), detail: z.string().optional() }),
  ),
});

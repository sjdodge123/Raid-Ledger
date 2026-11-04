import { z } from "zod";
import { GuildCrestSchema } from "./guild-crest.schema.js";
import { GuildKindSchema } from "./guilds.schema.js";

/**
 * ROK-2071 — the Core "Hub" event field. `GET /guilds/taggable?gameId=`
 * lists every hub of that game the viewer may tag an event to: any live hub
 * kind (WoW guild, game server, community), staff all, others only the hubs
 * they edit — the same rights `PATCH /events/:id { guildId }` enforces.
 */
const id = z.number().int().positive();

export const TaggableHubsQuerySchema = z
  .object({ gameId: z.coerce.number().int().positive() })
  .strict();
export type TaggableHubsQuery = z.infer<typeof TaggableHubsQuerySchema>;

/** One hub the viewer may tag an event to. */
export const TaggableHubSchema = z
  .object({
    id,
    gameId: id,
    kind: GuildKindSchema,
    name: z.string(),
    /** The hub's resolved crest (upload or preset); null = initials. */
    crest: GuildCrestSchema.nullable(),
  })
  .strict();
export type TaggableHub = z.infer<typeof TaggableHubSchema>;

/** `GET /guilds/taggable?gameId=` — sorted by name. */
export const TaggableHubsSchema = z
  .object({ hubs: z.array(TaggableHubSchema) })
  .strict();
export type TaggableHubs = z.infer<typeof TaggableHubsSchema>;

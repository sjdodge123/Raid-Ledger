/**
 * ROK-1854 — Valheim recipe planner storage (D3). One `valheim_recipe_sets`
 * row per server + game version (latest `captured_at` wins, D4); five child
 * tables hold the set's stations, recipes, pieces, processors and processes,
 * replaced wholesale on re-import. Requirement lists are jsonb on the parent
 * (bounded, never queried alone). No column references `users`.
 */
import {
  pgTable,
  serial,
  integer,
  smallint,
  text,
  boolean,
  jsonb,
  doublePrecision,
  index,
  unique,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  ValheimCraftingStation,
  ValheimPiece,
  ValheimProcess,
  ValheimProcessor,
  ValheimProcessorType,
  ValheimRecipe,
} from '@raid-ledger/contract';
import {
  importedAt,
  serverFk,
  snapshotCol,
  snapshotFk,
  tsz,
} from './valheim-columns';

/** ROK-1854: one recipe export per server per game version (D1). */
export const valheimRecipeSets = pgTable(
  'valheim_recipe_sets',
  {
    id: serial('id').primaryKey(),
    pelicanServerId: serverFk(),
    gameVersion: text('game_version').notNull(),
    locale: text('locale').notNull(),
    capturedAt: tsz('captured_at').notNull(),
    atlasSha256: text('atlas_sha256'),
    atlasWidth: integer('atlas_width'),
    atlasHeight: integer('atlas_height'),
    sourceSnapshotId: snapshotCol(),
    importedAt: importedAt(),
  },
  (t) => [
    unique('valheim_recipe_sets_version_uq').on(
      t.pelicanServerId,
      t.gameVersion,
    ),
    index('valheim_recipe_sets_server_captured_idx').on(
      t.pelicanServerId,
      t.capturedAt,
    ),
    index('valheim_recipe_sets_source_snapshot_idx').on(t.sourceSnapshotId),
    snapshotFk('valheim_recipe_sets', t.sourceSnapshotId),
  ],
);

/** The owning set; children are deleted with it. */
const setFk = () =>
  integer('set_id')
    .notNull()
    .references(() => valheimRecipeSets.id, { onDelete: 'cascade' });

export const valheimRecipeStations = pgTable(
  'valheim_recipe_stations',
  {
    setId: setFk(),
    prefab: text('prefab').notNull(),
    name: text('name').notNull(),
    maxLevel: smallint('max_level').notNull(),
    stackableExtension: boolean('stackable_extension').notNull(),
    upgrader: boolean('upgrader').notNull().default(false),
    icon: jsonb('icon').$type<NonNullable<ValheimCraftingStation['icon']>>(),
  },
  (t) => [
    primaryKey({
      name: 'valheim_recipe_stations_pk',
      columns: [t.setId, t.prefab],
    }),
  ],
);

export const valheimRecipes = pgTable(
  'valheim_recipes',
  {
    setId: setFk(),
    /** The wire `id` (asset name or `<result>.<n>`). */
    recipeId: text('recipe_id').notNull(),
    result: text('result').notNull(),
    amount: integer('amount').notNull(),
    enabled: boolean('enabled').notNull(),
    station: text('station'),
    repairStation: text('repair_station'),
    minStationLevel: smallint('min_station_level').notNull(),
    upgradeOnly: boolean('upgrade_only').notNull(),
    anyOneOf: boolean('any_one_of').notNull(),
    qualityResultAmountMultiplier: doublePrecision(
      'quality_result_amount_multiplier',
    ).notNull(),
    formula: text('formula').$type<ValheimRecipe['formula']>().notNull(),
    resources: jsonb('resources').$type<ValheimRecipe['resources']>().notNull(),
  },
  (t) => [
    primaryKey({ name: 'valheim_recipes_pk', columns: [t.setId, t.recipeId] }),
    index('valheim_recipes_set_result_idx').on(t.setId, t.result),
    check(
      'valheim_recipes_formula_chk',
      sql`${t.formula} IN ('vanilla','custom')`,
    ),
  ],
);

export const valheimPieces = pgTable(
  'valheim_pieces',
  {
    setId: setFk(),
    prefab: text('prefab').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    tool: text('tool').notNull(),
    station: text('station'),
    icon: jsonb('icon').$type<NonNullable<ValheimPiece['icon']>>(),
    resources: jsonb('resources').$type<ValheimPiece['resources']>().notNull(),
  },
  (t) => [
    primaryKey({ name: 'valheim_pieces_pk', columns: [t.setId, t.prefab] }),
  ],
);

export const valheimProcessors = pgTable(
  'valheim_processors',
  {
    setId: setFk(),
    prefab: text('prefab').notNull(),
    type: text('type').$type<ValheimProcessorType>().notNull(),
    fuel: text('fuel'),
    fuelPerProduct: integer('fuel_per_product'),
    fuelSecondsPerUnit: doublePrecision('fuel_seconds_per_unit'),
    windPowered: boolean('wind_powered').notNull(),
    requiresRoof: boolean('requires_roof').notNull(),
    maxInput: integer('max_input'),
    burntResult: text('burnt_result'),
    defaultResult:
      jsonb('default_result').$type<
        NonNullable<ValheimProcessor['defaultResult']>
      >(),
  },
  (t) => [
    primaryKey({ name: 'valheim_processors_pk', columns: [t.setId, t.prefab] }),
    check(
      'valheim_processors_type_chk',
      sql`${t.type} IN ('smelter','fermenter','cooking','incinerator')`,
    ),
  ],
);

export const valheimProcesses = pgTable(
  'valheim_processes',
  {
    setId: setFk(),
    /** Wire index in `processes[]` (sorted by processor, priority desc). */
    ord: smallint('ord').notNull(),
    processor: text('processor').notNull(),
    inputs: jsonb('inputs').$type<ValheimProcess['inputs']>().notNull(),
    anyOneOf: boolean('any_one_of').notNull(),
    outputPrefab: text('output_prefab').notNull(),
    outputAmount: integer('output_amount').notNull(),
    seconds: doublePrecision('seconds'),
    priority: integer('priority').notNull(),
  },
  (t) => [
    primaryKey({ name: 'valheim_processes_pk', columns: [t.setId, t.ord] }),
    index('valheim_processes_set_output_idx').on(t.setId, t.outputPrefab),
  ],
);

export type ValheimRecipeSetRow = typeof valheimRecipeSets.$inferSelect;
export type NewValheimRecipeSet = typeof valheimRecipeSets.$inferInsert;
export type ValheimRecipeStationRow = typeof valheimRecipeStations.$inferSelect;
export type NewValheimRecipeStation = typeof valheimRecipeStations.$inferInsert;
export type ValheimRecipeRow = typeof valheimRecipes.$inferSelect;
export type NewValheimRecipe = typeof valheimRecipes.$inferInsert;
export type ValheimPieceRow = typeof valheimPieces.$inferSelect;
export type NewValheimPiece = typeof valheimPieces.$inferInsert;
export type ValheimProcessorRow = typeof valheimProcessors.$inferSelect;
export type NewValheimProcessor = typeof valheimProcessors.$inferInsert;
export type ValheimProcessRow = typeof valheimProcesses.$inferSelect;
export type NewValheimProcess = typeof valheimProcesses.$inferInsert;

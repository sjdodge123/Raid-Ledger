import { z } from 'zod';
import { ValheimCharacterMessageSchema } from './valheim-link-character.schema.js';
import { ValheimItemsMessageSchema } from './valheim-link-items.schema.js';
import { ValheimMapMessageSchema } from './valheim-link-map.schema.js';
import { VALHEIM_LINK_SCHEMA_VERSION } from './valheim-link-common.schema.js';

/**
 * Every message RL Valheim Link pushes, discriminated by `kind`
 * (ROK-1829). The ingest endpoint (ROK-1833) parses with this.
 */
export const ValheimLinkMessageSchema = z.discriminatedUnion('kind', [
    ValheimCharacterMessageSchema,
    ValheimMapMessageSchema,
    ValheimItemsMessageSchema,
]);
export type ValheimLinkMessage = z.infer<typeof ValheimLinkMessageSchema>;

export const ValheimLinkMessageKindSchema = z.enum(['character', 'map', 'items']);
export type ValheimLinkMessageKind = z.infer<typeof ValheimLinkMessageKindSchema>;

/**
 * Valheim Link wire contract (ROK-1829): Raid Ledger owns it;
 * `packages/contract/valheim-link/v<n>/schema.json` is GENERATED from
 * `ValheimLinkMessageSchema` by this function — run
 * `node packages/contract/scripts/gen-valheim-link-schema.mjs` after
 * `npm run build -w packages/contract`. A contract vitest drift guard
 * fails when the committed file differs.
 */
export const VALHEIM_LINK_SCHEMA_ID =
    `https://raid.gamernight.net/contracts/valheim-link/v${VALHEIM_LINK_SCHEMA_VERSION}/schema.json`;

/** The JSON Schema object for one pushed message. */
export function buildValheimLinkJsonSchema(): Record<string, unknown> {
    const generated: Record<string, unknown> = z.toJSONSchema(ValheimLinkMessageSchema, {
        target: 'draft-2020-12',
        // INPUT mode: what the server ACCEPTS (see ledgerlink-json-schema.ts).
        io: 'input',
        unrepresentable: 'throw',
    });
    return {
        ...generated,
        $id: VALHEIM_LINK_SCHEMA_ID,
        title: `RL Valheim Link message v${VALHEIM_LINK_SCHEMA_VERSION}`,
        description:
            'GENERATED from ValheimLinkMessageSchema (packages/contract/src/valheim-link-*.schema.ts) — do not edit by hand. Refinements (grid bounds, uniqueness, bitmap size) are enforced by the server but not expressible here; see CONTRACT.md.',
    };
}

/** Exact file contents of `schema.json` (2-space indent, trailing newline). */
export function serializeValheimLinkJsonSchema(): string {
    return `${JSON.stringify(buildValheimLinkJsonSchema(), null, 2)}\n`;
}

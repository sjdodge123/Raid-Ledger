import type { DecodedAddonPaste } from '../addon-import.decoder';

/**
 * The `.json` shape of a valid LedgerLink golden fixture
 * (`packages/contract/ledgerlink/v1/CONTRACT.md` §8, v2 likewise), shared by
 * the generator and the conformance spec so they can never disagree:
 * - single-section paste → `{ pages, payload }` (unchanged since ROK-1724);
 * - mixed paste (ROK-1737) → `{ sections: [{ section, pages, payload }] }`
 *   in canonical order char → guild → raid → loot, whatever the paste order.
 * A v2 `loot` section (ROK-2184) has the same `{ pages, payload }` view: the
 * decoded loot export as the decoder hands it to apply (always `pages: 1` —
 * loot is never paged).
 */
export function ledgerLinkFixtureView(decoded: DecodedAddonPaste): object {
  const sections = decoded.order.flatMap((section) => {
    const s = decoded.sections[section];
    return s ? [{ section, pages: s.pages, payload: s.payload }] : [];
  });
  const [only] = sections;
  if (only && sections.length === 1) {
    return { pages: only.pages, payload: only.payload };
  }
  return { sections };
}

interface FixtureViewShape {
  pages?: number;
  payload?: object;
  sections?: { section: string; pages: number; payload: object }[];
}

/**
 * A fixture view with every payload's envelope `schema` replaced — how a v1
 * view maps onto its v2 twin (ROK-2184 AC 2: identical apart from `schema`).
 */
export function fixtureViewWithSchema(view: object, schema: number): object {
  const v: FixtureViewShape = view;
  if (v.sections) {
    return {
      sections: v.sections.map((s) => ({
        ...s,
        payload: { ...s.payload, schema },
      })),
    };
  }
  return { ...v, payload: { ...v.payload, schema } };
}

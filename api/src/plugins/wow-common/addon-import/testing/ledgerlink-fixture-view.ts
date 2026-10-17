import type { DecodedAddonPaste } from '../addon-import.decoder';

/**
 * The `.json` shape of a valid LedgerLink golden fixture
 * (`packages/contract/ledgerlink/v1/CONTRACT.md` §8), shared by the
 * generator and the conformance spec so they can never disagree:
 * - single-section paste → `{ pages, payload }` (unchanged since ROK-1724);
 * - mixed paste (ROK-1737) → `{ sections: [{ section, pages, payload }] }`
 *   in canonical order char → guild → raid, whatever the paste order.
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

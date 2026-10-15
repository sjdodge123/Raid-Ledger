/**
 * ROK-1786: the addon link parser lives in the contract
 * (`packages/contract/src/guild-addon-link.ts`) so the web preview and the
 * server agree on every input. Re-exported here for the guild services.
 */
export {
  addonLinkUrl,
  parseAddonLink,
  titleCaseSlug,
  type AddonLinkResult,
  type ParsedAddonLink,
} from '@raid-ledger/contract';

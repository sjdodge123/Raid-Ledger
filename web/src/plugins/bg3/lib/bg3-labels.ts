/**
 * ROK-1958 D-7 — display labels for raw `bg3-save` ids. The pure helpers live
 * in the contract (`packages/contract/src/bg3-labels.ts`, ROK-2153 S6) so the
 * api builds the same labels; this module re-exports them for web importers.
 */
export {
    bg3ClassesLabel,
    bg3ClassLabel,
    bg3OriginLabel,
    bg3RaceLabel,
    bg3SummonName,
    bg3SummonsLine,
    humaniseBg3Id,
} from '@raid-ledger/contract';

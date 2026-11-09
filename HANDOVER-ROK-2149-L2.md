# ROK-2149 L2 handover — insights professions widening (Q4=A) — DONE, tests unrun

## Handover
Commits: ef25b7561 (contract + api), 52f3d93ea (web readers + Q5 copy), c806a1786 (web tests).

- Contract `wow-roster-insights.schema.ts`: profession member → `WowRosterProfessionMemberSchema`
  (`characterId` nullable, optional `memberId` int>0, refine: null characterId needs memberId).
  Old payloads parse (contract spec `hub-widgets-contract.schema.spec.ts`, new describe). Classification:
  type WIDENING, not breaking (nothing tightened for old shapes; nothing stored is re-parsed).
- API: `InsightRow.memberId?` (optional so existing fixtures compile), `toInsightRow` passes it,
  `computeProfessions` emits rows with a character OR a memberId; memberId rides on linked rows too.
  Snapshot facts reach unlinked rows via ROK-2133 `loadMemberFacts` (linked character's facts still win there).
- Web: `lib/profession-member-key.ts` (`rowProfessionKey`, `professionMemberKey`) used by
  `wow-member-professions.ts` (`useRowProfessions(row)`), `wow-member-filters.helpers.ts`, `professions.helpers.ts`,
  `professions-widget.tsx`, `wow-profession-coverage.tsx` (new required `index` prop, "Professions known: X of N").
  Filter label "Profession"; scope copy "Professions from linked characters and the Blizzard Armory".

## NOT verified
Nothing run locally (no node_modules). Needs: contract vitest, api tsc + `roster-insights.helpers.spec.ts`,
`roster-insights.integration.spec.ts` (new AC-13 case seeds its own guild), web tsc (app + test configs) +
the 4 touched web test files, eslint on touched files. New assertions not yet mutation-checked.

## Deliberately not done
NameCell / CharacterLink `unlinkedTo` / member page (L3/L4). Widget footer copy still says "characters" (Q9 out of scope).

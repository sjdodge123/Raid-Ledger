# Handover — ROK-2125 (quests.completed optional, additive v1)

Status: implementation complete, all commits on `feat/rok-2125-quests-completed-optional` (not pushed).
Local: contract vitest 1841/1841 green; tsc `-p api/tsconfig.json` clean; eslint clean on touched files
(one pre-existing max-lines-per-function warning on the original describe in forever-quest-source.helpers.spec.ts);
jest unit: forever-quest-source.helpers.spec, addon-import-char.quests-carry.spec, ledgerlink-contract.spec green.
NOT run (fleet): `api/src/plugins/wow-common/character-quests.log-only-import.integration.spec.ts`.

Semantics:
- ABSENT `completed` = no opinion. effectiveQuests takes list/flag/date/source from the Armory; log from the addon.
  No Armory list -> null (unknown), never "none completed".
- Import: a log-only `quests` carries the stored row's completed list (+ truncation flag) into the new snapshot
  (`addon-import-char.quests-carry.ts`), so storage never loses it.
- EMPTY `[]` = unchanged ("completed nothing"); the Armory still wins when present (ROK-2138).

Next: fleet `--static` gate + run the new integration spec alone; ROK-2137 conflict -> whoever merges second
re-runs `npm run gen:ledgerlink-schema -w packages/contract` and merges CHANGELOG entries.
Risk: the carried list keeps the new export's capturedAt (date slightly overstated for the carried list).

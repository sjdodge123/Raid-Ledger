## Handover — ROK-1860 fix lane (FIXLIST-1860.md)

Done (each committed, tsc app+test clean, eslint clean on changed files):
- #2/#7 cap — 3b929fe5a. `usePlannerSources` setter returns false and refuses a NEW prefab at VALHEIM_PLAN_SOURCES_MAX; re-pick of a stored prefab still works. Test: planner-sources.test.ts (red: refused undefined / size 65).
- #6 Esc bubbling — 441136392. `useDeselect.onEscape` bails while `hasOpenEscapeLayer()` (new export in web/src/hooks/use-escape-layer.ts). A DOM-containment check was tried first and did NOT fix it in jsdom (focus still on the chip when Esc lands), so the layer check is deliberate. Test in planner-source-picker.test.tsx (red: "the Iron sword detail should still be selected").
- #1 anyOneOf — aeffa30ae. `RecipeTree` Branch passes `underAnyOneOf` to children of an anyOneOf recipe; those rows get no chooser. Test: recipe-tree-sources.test.tsx (red: button not null).
- #5 integration — 8d9d18ab8. New describe "catalogue sourceOptions, partly hidden": knownRecipes = ALL_KNOWN − 'Bronze' + 'Recipe_Bronze'. NOT RUN (fleet). Assumes R3 hides Recipe_Bronze5 when neither its id nor 'Bronze' is listed, and Coal keeps both processes.

Not done:
- #3 pending refocus (use-source-chooser.tsx:37). Plan: in `refocus(prefab)` also add a one-shot capture `pointerdown` listener on document that clears `pending` (NOT focusin — the picker's own focus-restore to the chip fires focusin before the remount and would break AC9). Test: harness with PlannerSourcesContext + RecipeTree whose ids don't change, pick, click body text, rerender → focus must not jump back.
- #4 nested BottomSheet test (<1024px, crafting detail sheet → Full breakdown → picker → Esc). Suggest a fleet test-plan phone step or a vitest case with media.desktop=false in planner-source-picker.test.tsx.

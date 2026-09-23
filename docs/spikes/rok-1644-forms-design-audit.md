# ROK-1644 — Forms design-system audit: form primitives and migration plan

| | |
|---|---|
| **Tier** | Spike (`docs/**` only). Review is the Codex pass and nothing else (CLAUDE.md "Spike review tier") |
| **Base** | `origin/main` @ `fadd12ff0` (includes PR #1320, the design-system keep-current rule). The lane reports were taken at `fd8f6f3c8`. #1320 changed only docs/config, so their anchors still hold |
| **Inputs** | `planning-artifacts/AUDIT-1644-admin.md` (41 admin files) and `planning-artifacts/AUDIT-1644-user.md` (66 user-facing files). Both are gitignored lane reports |
| **Reference** | `docs/design-system.md` §2.1, §2.2, §2.5, §3.1, §4.4, §4.11, §4.18, §6.3, §6.9; `docs/design-system-tokens.md` §1, §3 |
| **Pending, not on main** | `components/ui/switch.tsx` (ROK-1612); the sheet rules plus `use-body-scroll-lock` (ROK-1640, PR #1314); `useDirtyCloseGuard` (ROK-1640, not shipped anywhere); the raw-hue light repaints plus `raw-hue-light.guard.test.ts` (PR #1318) |
| **Output** | This doc only. Nothing is filed in Linear, and no code changes |

## Provenance

No Linear issue body was provided, so the scope comes from the Lead's brief and the two lane reports. Both
lanes cite the line where the JSX **element opens**. The `className` is often one or two lines lower. I
spot-checked this at base `fadd12ff0`, and the anchors hold. Some examples:

| Lane anchor | Element opens | `className` / `style` line |
|---|---|---|
| `CronJobModals.tsx:225` | `:225` `<button onClick={onSave}` | `:226` `bg-accent … text-white` (design-system.md §6.3 cites `:226`, which is the same bug) |
| `FeedbackDialog.tsx:133` | `:133` | `:135` `style={{ backgroundColor: 'var(--color-accent)' }}` |
| `FeedbackWidget.tsx:78` | `:78` | `:79` inline `var(--color-accent)` |
| `reschedule-controls.tsx:41,45,57` | `:41,45,57` | `:43,47,59` (`ring-primary`) |
| `cancel-event-modal.tsx:53` | `:53` | `:55` |
| `modal-helpers.tsx:7` | `INPUT_CLS` const `:7` | `:8` `focus:ring-accent` |
| `CalendarGameFilter.tsx:70` | `:70` | `:71` `bg-base` |

Anchors in this doc are the lanes' anchors, so they are element lines. The only anchors I added are the
ones marked **(verified here)**.

---

## 1. Summary

**107 files audited** (41 admin + 66 user-facing). Across them, **every form control type has between 8
and ~36 visual variants, and none of them comes from a shared primitive.** `components/ui` has no
Button, Input, Select, Textarea, Checkbox or Field today (§3.1 inventory).

| Control | Admin tags / variants | User tags / variants | Total tags |
|---|---|---|---|
| Text / number / password / search / date `<input>` | 25 / 22 | 59 / ~36 (29 inline buckets + 8 module constants) | **84** |
| `<select>` | 14 / 12 | 12 / 8 | **26** |
| `<textarea>` | 2 / 2 | 7 / 7 (every one is unique) | **9** |
| Checkbox and switch | 12 / 8 (3 are `sr-only peer` switches) | 14 / 10 (+2 bespoke switches) | **26** |
| Radio | — | 2 / 2 | **2** |
| Range | (inside the 6 file/colour/range) | 9 / 3 | **~9** |
| `<button>` | **93** / 69 distinct className strings | **108**; 7 disabled treatments; ~70 with no disabled style | **201** |
| `<label>` | 47, of which 27 use `htmlFor` (12 are orphans) | 81, of which **24** use `htmlFor` | 128, of which **51 (40%) use `htmlFor`** |

**Accessibility, both lanes:**
- **`focus-visible:` has 0 uses.**
- **`aria-invalid` has 0 uses.**
- `aria-describedby` has one real use, `CommunityInsightsSection.tsx:109`.
- `role="alert"` appears on errors 3 times in admin and 0 times in user files.
- `aria-busy` has 0 uses.
- **About 65 controls have no accessible name** (my tally of the lanes' lists: 26 admin, §2.3, and 37 user, §2.A). `ModalSearchInput` counts once, but every modal that uses it inherits the gap.
- 40 buttons have no `type` (user lane).

**Undefined tokens, which generate no CSS rule** (verified here: none of them is declared in `index.css`):

| Utility / var | Where | Effect |
|---|---|---|
| `--color-accent`, plus `bg-/text-/border-/ring-accent` | 6 inline `var()` and about 19 utilities across 12 files (design-system.md §6.3) | Buttons lose their fill, focus rings vanish |
| `--color-border` | `FeedbackDialog.tsx` ×3 (admin lane, new) | The textarea has no border |
| `ring-primary` | `reschedule-controls.tsx:41,45,57`, `cancel-event-modal.tsx:53` | No focus ring |
| `ring-accent` | `modal-helpers.tsx:7`, `activity-modal.tsx:82`, `backup-panel-modals.tsx:104`, `CronJobModals.tsx:199`, `cron-jobs-panel.tsx:118` | No focus ring |
| `bg-base` | `CalendarGameFilter.tsx:70` | Transparent background |
| **`text-primary`** (new, verified here, outside both lanes' scope except one row) | 8 files, including `InviteeMultiSelect.tsx:140` (a label, in the user scope), `StillWaitingPanel.tsx:28,44`, `VisibilityToggle.tsx:20`, `DiscordText.tsx:23` | Inherits `currentColor`. Visually harmless, but it's dead styling |

**Other headline findings:**
- **Invisible primary buttons** (§2 P1): `CronJobModals.tsx:225` Save, `FeedbackDialog.tsx:133` Send Feedback, the desktop FAB at `FeedbackWidget.tsx:78`, and `backup-panel-modals.tsx:135`. In all six light themes the label is white on a transparent fill.
- **Error text uses `text-red-400`.** The admin lane counts 32 against 1 use of `text-danger`, and the user lane ~36 against 0. Repo-wide it's 154 against 2 (verified here). On light themes it repaints to `#dc2626`. The lanes disagree on its contrast (see the conflict note below). Either way it sits below or on the AA line on `bg-panel`, while `text-danger` is guarded at ≥4.99:1.
- **iOS focus zoom.** Exactly **one** text entry in 107 files uses `text-base` (`CommonGroundFilters.tsx:85`). The admin "tall" recipe has no text size, and the phone-first surfaces (mobile toolbars, the Away sheet, onboarding) are `text-sm`/`text-xs`.
- **The game-search combobox has two implementations** (`game-search-input.tsx:196`, `poll-game-search.tsx:89`). They have no `role="combobox"`, `aria-expanded`, `aria-controls` or `aria-activedescendant`, and no `onKeyDown`. **You can't reach the results from the keyboard.** It's used by create event, Add Character and onboarding.
- **Validation errors are mostly toast-only** (8 admin forms, plus `edit-lineup-metadata-modal.tsx:76`). That goes against design-system.md §4.8.
- **Disabled and loading states:**
  - `disabled:bg-*-800` has 26 admin uses, against 23 for `disabled:opacity-50`. It renders as a dark block on light themes.
  - Loading is a text swap at 61 sites (43 admin + 18 user) with no `aria-busy`, so the button width jumps.
- **No form has a pinned footer or a dirty-close guard** (ROK-1640 isn't on main).

**Lane conflicts, as recorded:**
1. **`text-red-400` contrast on light.** `design-system-tokens.md` §1 and the admin lane say 4.6:1 on white. The user lane recomputed 4.83:1 on white and **4.41:1 on `bg-panel`**. `#dc2626` on `#ffffff` is the standard red-600 pair, 4.83:1, so the user lane looks right. The tokens-doc figure should be rechecked when the primitives PR updates the doc. The conclusion doesn't change: switch to `text-danger`.
2. **Radius.** The admin lane recommends `rounded-lg` (155 admin uses; design-system.md §2.5 calls it the default for inputs). The user lane follows §4.11's `rounded-md`. The design-system doc contradicts itself here. See §6 Q5.
3. **Desktop font breakpoint.** The admin lane uses `text-base sm:text-sm` and the user lane `text-base lg:text-sm`. §4.18 puts iPads on phone layouts below 1024px, so **`lg:` is correct**.
4. **Primitive location.** The admin lane wants flat files in `components/ui/`. The user lane wants a `components/ui/form/` directory. See §4.0.
5. **Button loading spinner.** The user lane says to reuse `loading-spinner.tsx`. That file is a **full-page** Suspense spinner (`min-h-[60vh]`, verified here), so it can't sit inside a button. Button needs its own inline spinner.
6. **`backup-panel-modals.tsx:135`.** The admin lane groups it with the "white label on transparent" buttons. At base, the classes are `bg-accent/20 text-accent border-accent/40` (verified here). The label inherits its colour and stays visible, but **the button has no fill and no border**. It reads as plain text. Same fix, lower severity.

---

## 2. Bugs to fix now (primitives not required)

These can ship as **one small fix story** ahead of the primitives. Every row is a class swap or an added
attribute. Sorted by priority. The file count is about 30 and the diff about 150 lines. That puts it in
the **standard** tier, not trivial (multi-file), but it's low risk. It's cosmetic UI, so a screenshot in
each family is enough. Note that `CronJobModals` / `backup-panel-modals` / `FeedbackDialog` also appear
in migration batches M4 and M8. This story fixes the visible bug only.

### P1 — Invisible or chrome-less buttons

| # | Anchor | Bug | Fix |
|---|---|---|---|
| 1 | `pages/cron-jobs/CronJobModals.tsx:225` | Save is `bg-accent … text-white`, so it's white on transparent | `bg-emerald-600 hover:bg-emerald-500 text-foreground` (the forced-white label rule is keyed to `bg-emerald-600`, `index.css:780-787`) |
| 2 | `components/feedback/FeedbackDialog.tsx:133` | Send Feedback uses inline `backgroundColor: var(--color-accent)` | Drop the `style` and use the same class trio as #1 |
| 3 | `components/feedback/FeedbackWidget.tsx:78` | The desktop FAB fill is `var(--color-accent)`, and its icon is white | Drop the `style` and use `bg-emerald-600 hover:bg-emerald-500 text-foreground` |
| 4 | `pages/admin/backup-panel-modals.tsx:135` | "Go to Login" is `bg-accent/20 text-accent border-accent/40`, so it has no fill or border | `bg-success/10 text-success border border-success/40 hover:bg-success/20` |

### P2 — Undefined tokens (dead focus rings, borders and fills)

| # | Anchor | Bug | Fix |
|---|---|---|---|
| 5 | `FeedbackDialog.tsx:99` | Textarea: `outline-none`, resting border `var(--color-border)` (undefined), and a JS `onFocus` swap to `var(--color-accent)`. It has **no border and no focus** | Remove `style`/`onFocus`/`onBlur` and apply the §4.11 frame: `bg-panel border border-edge rounded-lg px-3 py-2 text-base lg:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-success/50` |
| 6 | `FeedbackDialog.tsx:123` | Checkbox `accent-[var(--color-accent)]` | `accent-emerald-500` (the §4.11 recipe), plus the remaining `var(--color-accent)` sites at `:66,67` (design-system.md §6.3) |
| 7 | `components/ui/modal-helpers.tsx:7` | `ModalSearchInput` uses `focus:ring-accent`. **Every picker modal inherits this** | `focus:ring-emerald-500/50` |
| 8 | `pages/user-profile/activity-modal.tsx:82` | `focus:ring-accent` | Same as #7 |
| 9 | `components/events/reschedule-controls.tsx:41,45,57` | `focus:ring-primary` | `focus:ring-2 focus:ring-emerald-500/50` |
| 10 | `components/events/cancel-event-modal.tsx:53` | `ring-1 ring-primary` | `focus:ring-2 focus:ring-emerald-500/50` |
| 11 | `pages/calendar/CalendarGameFilter.tsx:70` | `bg-base`, and focus shows only as a border colour | `bg-panel`, plus `focus:ring-2 focus:ring-emerald-500/50` |
| 12 | `pages/admin/backup-panel-modals.tsx:104`, `pages/cron-jobs/CronJobModals.tsx:199`, `pages/admin/cron-jobs-panel.tsx:118` | `ring-accent` / `border-accent` | `focus:ring-emerald-500/50 focus:border-transparent` |
| 13 | design-system.md §6.3 sites outside the forms scope: `AvatarUploadZone.tsx`, `logs-panel.tsx`, `backups-panel.tsx:93,114`, `CronJobCard.tsx:117`, `identity-sections.tsx:91,95` | Dead `*-accent` | Replace each one with the explicit hue its meaning calls for. **These are required**, or the guard test in #27 fails |
| 14 | `text-primary` ×8 files (verified here) | Dead utility | `text-foreground`. Severity: nit |

### P3 — Missing accessible names (add `id` + `htmlFor`, or `aria-label`)

| # | Anchor | Fix |
|---|---|---|
| 15 | `admin/onboarding/secure-account-step.tsx:83-84` (×3 password fields; a local `PasswordInput` shadows the helper) | Give each `<input>` an `id` from `useId()` and each label `htmlFor` |
| 16 | `admin/onboarding/community-identity-step.tsx:47,87`; `pages/admin/general-panel.tsx:65`; `TimezoneSection.tsx:12` (timezone selects) | `id` + `htmlFor` |
| 17 | `onboarding/character-step.tsx:64,65,68,72,123`; `character-form-fields.tsx:44,56`; `inline-character-form.tsx:44,45,48,51,92` | `id` + `htmlFor` on the existing labels, or `aria-label` where no label exists |
| 18 | `components/ui/modal-helpers.tsx:21` (`ModalSearchInput`) | Add a required `label` prop and render it as `aria-label` (fixes every consumer) |
| 19 | `NominateModal.tsx:43,123`; `admin/UserManagementRow.tsx:201` | `aria-label` |
| 20 | `CronJobModals.tsx:50` (✕); `AvailabilityForm.tsx:65` (icon close, no `type`) | `aria-label="Close"` and `type="button"` |
| 21 | `min-vote-threshold-slider.tsx:32` (its label at `:25` has no `htmlFor`) | `id` + `htmlFor` |
| 22 | `pages/login/LocalLoginForm.tsx:83` (the login error is silent to screen readers) | `role="alert"` |

The remaining ~40 unnamed controls (search boxes, date and time fields, sliders, WoW plugin fields) go
with their migration batch through `Field` / `SearchInput`. Fixing them by hand now would mean touching
them twice.

### P4 — Focus

| # | Anchor | Fix |
|---|---|---|
| 23 | `admin/admin-form-helpers.tsx:60` (`CopyableInput`: `focus:outline-none` with no ring; 5 instances in `DiscordOAuthForm`) | Add `focus-visible:ring-2 focus-visible:ring-emerald-500/50` |
| 24 | `components/events/invite-modal.tsx:155` (read-only URL, `outline-none`); `InstallSizeEntryModal.tsx:76` (no ring) | Same as #23 |
| 25 | `AwayAddForm.tsx:14` (the only focus cue is a border colour; also `text-sm` in a phone sheet) | Add the ring and `text-base lg:text-sm` |
| 26 | `admin/DiscordBotForm.tsx:33` (`role="switch"` with no focus style) | Add the ring. The switch itself moves to `Switch` in M3 |

### P5 — Guard, iOS zoom, contrast

| # | Anchor | Fix |
|---|---|---|
| 27 | New `web/src/styles/undefined-tokens.guard.test.ts` | Collect every `var(--color-X)` and every `(bg|text|border|ring|outline|accent|fill|stroke|placeholder)-X` whose `X` is neither a declared `--color-*` nor a Tailwind palette or keyword, and fail on any hit. It closes design-system.md §6.3's "plus a guard test". **Strip comments before scanning** (a lesson recorded in project memory) |
| 28 | Phone-only inputs: `events-mobile-toolbar.tsx:47,52`, `players-mobile-toolbar.tsx:20`, `more-drawer-impersonate.tsx:62`, `character-step.tsx:29` (`FIELD_CLS`) | `text-sm` → `text-base lg:text-sm` (stops iOS zoom) |
| 29 | `text-blue-300/400` (`wow-armory-import-form.tsx:148`, `character-create-import-form.tsx:41`, `character-create-inline-import.tsx:19`, `cloud-provider-card.tsx:151`) and `text-amber-300` (`UserManagementRow.tsx:75,100`, `lfg-board-section.tsx:26,31`, `secure-account-step.tsx:56`) | **Wait for PR #1318 first.** If its raw-hue repaint covers these shades (design-system.md §6.9), drop this row. Otherwise switch to `text-warning` or `text-foreground` |

---

## 3. Pattern catalogue (merged and deduplicated)

Where both lanes found the same recipe, it appears as one row. Anchors are drawn from both reports.

### 3.1 Text inputs (84 tags, ~58 variants)

| # | Recipe | Copies | Examples | What's wrong |
|---|---|---|---|---|
| IN-1 | **Tall** `w-full px-4 py-3 bg-surface/50\|bg-panel border(-edge) rounded-lg focus:ring-2 focus:ring-{hue}` | ~19 | Admin I1: `admin-form-helpers.tsx:29,73`, `admin-settings-integration-cards.tsx:93,99`, `cloud-provider-card.tsx:77`, `GameLibraryTable.tsx:161`. User "large create": `create-event-form-sections.tsx:43,48,73,80`, `game-details-section.tsx:119,139`, `roster-section.tsx:60`, `game-search-input.tsx:196`, `poll-game-search.tsx:89`. `LocalLoginForm.tsx:4` | No text size (iOS zoom). Ring hue is emerald, blue, purple or `#5b9bd5` depending on the integration. The error state is `border-red-500` + `text-red-400` with no `aria-invalid` |
| IN-2 | **Standard compact** `px-3 py-2 bg-panel border-edge rounded-lg text-sm focus:ring-2 focus:ring-emerald-500` | ~17 | Admin I3: `BindingConfigFormFields.tsx:66,186` (no focus), `realm-autocomplete.tsx:98`, `wow-armory-import-form.tsx:162` (blue). User: `inline-character-form.tsx:23`, `character-form-fields.tsx:23`, `plan-event-time-slots.tsx:71,73`, `duration-section.tsx:28,42`, `SchedulingSuggestForm.tsx:40`, `member-picker-modal.tsx:78`, `AvailabilityForm.tsx:45` | ~38px tall, `text-sm`. Uses `placeholder-dim` (v3 spelling) ×3 |
| IN-3 | **44px field** `min-h-[44px] px-4 py-2.5 bg-surface(/50) text-sm` | 7 | Admin I2: `community-identity-step.tsx:47`, `secure-account-step.tsx:84`, `BrandingSection.tsx:35`, `branding-panel.tsx:96`. User: `character-step.tsx:29` (`FIELD_CLS`), `AwayAddForm.tsx:14` | The right height, but `text-sm` and `bg-surface`. The onboarding ones are unlabelled |
| IN-4 | **"/50 ring"** (the §4.11 DO) | 6 | `CommonGroundFilters.tsx:85` (the only one with `text-base` + 44px), `edit-lineup-metadata-modal.tsx:28`, `start-lineup-sliders.tsx:65,223`, `lineup-channel-override-select.tsx:39`, `players-page.tsx:34` | Everything except the first is `text-sm` with no min height |
| IN-5 | **Inline mini** `bg-overlay\|bg-panel px-2 py-1 rounded(-md)` | 7 | Admin I4: `ephemeral-voice-section.tsx:135`, `EditProfessionsModal.tsx:199`, `SessionLengthForm.tsx:67`. User: `reschedule-controls.tsx:41,45,57`, `InstallSizeEntryModal.tsx:76` | ~28–32px. No focus, or a dead focus ring |
| IN-6 | **Dead-token ring** | 4 | `backup-panel-modals.tsx:104`, `CooptimusForm.tsx:134`, `reschedule-controls.tsx` (`ring-primary`), `CronJobModals.tsx:199` | Covered by §2 P2 |
| IN-7 | **Read-only copy** | 2 | `admin-form-helpers.tsx:60` (`CopyableInput` ×5), `invite-modal.tsx:155` | `outline-none` with no ring. §2 P4 |
| IN-8 | **Hex colour text** `w-28 font-mono` | 2 | `BrandingSection.tsx:87`, `branding-panel.tsx:145` | Unlabelled, and it sits next to an unlabelled `type=color` (`:86`/`:144`) |
| IN-9 | **Destructive type-to-confirm** `bg-surface/50 focus:ring-red-500` | 2 | `delete-account-panel.tsx:50`, `identity-panel.tsx:276` | A duplicated pair, 17 raw hue classes each |

### 3.2 Search boxes (13+ variants, one job)

| Recipe | Sites | What's wrong |
|---|---|---|
| `ModalSearchInput` (`bg-surface/50 rounded-lg text-sm ring-accent`) | `modal-helpers.tsx:7`, plus every picker modal | Dead ring, no label |
| Per-page search | `activity-modal.tsx:82`, `UserMenu.tsx:154` (`text-xs py-1 ring-1`), `more-drawer-impersonate.tsx:62`, `invite-modal.tsx:241` (`ring-indigo-500/20`), `InviteeMultiSelect.tsx:144` (`ring-amber-500`), `NominateModal.tsx:43`, `games-step.tsx:83`, `CalendarGameFilter.tsx:70` (`bg-base`), `games-page.tsx:234` (`rounded-xl py-3`), `events-page.tsx:190`, `events-mobile-toolbar.tsx:47`, `players-mobile-toolbar.tsx:20`, `AssignmentPopupSections.tsx:12` (a BEM class), admin `GameLibraryTable.tsx:161`, `RoleManagementCard.tsx:145` (`pl-10` leading icon) | 9 of the 11 user sites have only a placeholder. One uses `type="search"`. Rings are indigo, amber or emerald |
| **Combobox** | `game-search-input.tsx:196` (list `role="listbox"` at `:67`/`:106`), `poll-game-search.tsx:89`, and probably `realm-autocomplete.tsx:98` (**UNVERIFIED**: the admin lane didn't classify its semantics) | No combobox ARIA, no keyboard support |

### 3.3 Selects (26 tags, 20 variants)

| # | Recipe | Sites | What's wrong |
|---|---|---|---|
| SE-1 | Compact panel `px-3 py-2 bg-panel focus:ring-emerald-500/40` or `blue-500` | 5 | `BindingConfigFormFields.tsx:217`, `BindingCreateForm.tsx:43,63`, `character-create-import-form.tsx:66`, `character-create-inline-import.tsx:42`. A third ring alpha (`/40`), and blue in the WoW files |
| SE-2 | Tall `px-4 py-3 bg-surface/50` (+`min-h-[44px]`) | 4+ | `general-panel.tsx:65`, `community-identity-step.tsx:87`, `discord-channels-page.tsx:131` (blue), `ai-model-selector.tsx:16` (purple), `TimezoneSection.tsx:12`. The timezone selects are unlabelled |
| SE-3 | Filter / row `text-sm bg-surface px-3 py-1.5 ring-1` | 4 | `UserManagementRow.tsx:201`, `play-history-select.tsx:24`, `role-select.tsx:24`, `playtime-min-input.tsx:29` (a number input in a filter family, the §4.11 DON'T). All ~32px |
| SE-4 | Dead accent ring | 2 | `cron-jobs-panel.tsx:118`, `CronJobModals.tsx:199` |
| SE-5 | Inline mini `bg-overlay px-2 py-1` | 2 | `ephemeral-voice-section.tsx:106`, `EditProfessionsModal.tsx:190` |
| SE-6 | Other user selects | ~9 | `inline-character-form.tsx:44,45,48`, `character-form-fields.tsx:56`, `lineup-channel-override-select.tsx:39`. Mostly unlabelled |

### 3.4 Textareas (9 tags, 9 variants)

| Site | Ring | Notes |
|---|---|---|
| `DynamicCategoryEditModal.tsx:108` | shared `FIELD_CLASSES` | **Best in class** (`LabelledInput` + `FieldError`), but the error isn't linked |
| `FeedbackDialog.tsx:99` | none (inline style, undefined vars) | §2 #5 |
| `cancel-event-modal.tsx:53` | `ring-1 ring-primary` (dead) | §2 #10 |
| `ReasonField.tsx:37` | `ring-rose-500/50` (not in the §2.2 hue list) | Has its own counter logic |
| `pug-form-modal.tsx:106` | `ring-1 ring-indigo-500` | |
| `NominateModal.tsx:123` | — | Unlabelled |
| `game-details-section.tsx:155`, `edit-lineup-metadata-modal.tsx:55`, `start-lineup-sliders.tsx:258` | emerald or `/50` | |

### 3.5 Checkboxes, switches, radios, ranges

| # | Recipe | Sites | What's wrong |
|---|---|---|---|
| CK-1 | DO: `w-5 h-5 accent-emerald-500` in a `<label>` | `CommonGroundFilters.tsx:167` | — |
| CK-2 | `h-4 w-4 rounded text-emerald-500 focus:ring-*` (a `@tailwindcss/forms` idiom; **the plugin isn't installed**, verified here, so these classes do nothing) | `ephemeral-voice-toggle.tsx:16,63`, `character-form-fields.tsx:74`, `source-multi-select.tsx:59`, `coop-filter-controls.tsx:97`, `user-profile-components.tsx:221`, `BindingConfigFormFields.tsx:100,134`, `ephemeral-voice-section.tsx:71` | 16px box |
| CK-3 | Other variants | `CHECKBOX_CLASS` (`BanUserModal.tsx:37,48`, `KickUserModal.tsx:38`), `accent-[#5b9bd5]` (`CooptimusForm.tsx:48`), `accent-[var(--color-accent)]` (`FeedbackDialog.tsx:123`), `InviteeMultiSelect.tsx:103`, `member-picker-modal.tsx:37`, `share-eta-row.tsx:29`, `start-lineup-*`, bare `secure-account-step.tsx:118` | Hex and dead token |
| SW-1 | `sr-only peer` + painted track | `discord-features-page.tsx:80`, `ephemeral-voice-section.tsx:34`, `lfg-board-section.tsx:75` (byte-identical), `PublicShareToggle.tsx:65` | The user copy doesn't expose `role="switch"` |
| SW-2 | `button role="switch"` | `DiscordBotForm.tsx:33`, `ephemeral-voice-toggle.tsx` | `bg-gray-600` off track (a raw grey), no focus style |
| RA-1 | Native radio | `series-scope-modal.tsx:31` | — |
| RA-2 | `sr-only` card | `duration-picker.tsx:38` | Two grammars for one job |
| RA-3 | **Segmented / pill toggles** (radio semantics, rendered as buttons) | `wow-armory-import-form.tsx:148`, `character-create-import-form.tsx:48,50`, `character-create-inline-import.tsx:28,32`, `cron-jobs-panel.tsx:103,151`, `FeedbackDialog.tsx:83`, colour swatches at `BrandingSection.tsx:73` (9 sites) | No `aria-pressed`, `role=tab` or `radiogroup`. `text-blue-300/400` is unreadable on light |
| RG-1 | DO: `SLIDER_CLS` (`h-11`, enlarged thumb) | duplicated at `CommonGroundFilters.tsx:41` and `coop-filter-controls.tsx:17` | — |
| RG-2 | `h-2` track | `start-lineup-sliders.tsx:116,155,189`, `start-lineup-nomination-target.tsx:58`, `min-vote-threshold-slider.tsx:32` | Under 44px, unlabelled |

### 3.6 Buttons (201)

| # | Recipe | Copies | Examples | What's wrong |
|---|---|---|---|---|
| BT-1 | **Primary solid** `bg-emerald-600 hover:bg-emerald-500` | ~36 (admin 15 + user ~21) | `BrandingSection.tsx:116`, `DiscordOAuthForm.tsx:90`, `NominateModal.tsx:134`, `AddCharacterModal.tsx:65`, `LocalLoginForm.tsx:91` | 5 paddings, 2 radii. `disabled:bg-emerald-800` goes dark on light. Label is `text-white` ×11, which opts out of the forced-white rule |
| BT-2 | **Other-hue primaries** | blue 8 ("Test Connection": `DiscordBotForm.tsx:47`, `IgdbForm.tsx:96`, `ItadForm.tsx:70`, `SteamForm.tsx:70`…), purple 4, violet 6 (user plan/reschedule/cancel ×5 + 1 admin), indigo 1, amber 1 (`KickUserModal.tsx:46`) | 20 | | None of these is a §2.2 hue role. See §6 Q4 |
| BT-3 | **Brand hex** | 4 | `CooptimusForm.tsx:104` `#5b9bd5`, `ItadForm.tsx:64` `#4a90d9`, `SteamForm.tsx:64` `#1B2838` (near-invisible on dark `bg-surface`), `secure-account-step.tsx:166` and `login-page.tsx` Discord `#5865F2` | Should be named brand constants |
| BT-4 | **Secondary**: two unrelated recipes | 15+ | `bg-overlay hover:bg-faint` (`BanUserModal.tsx:54`, `RoleManagementCard.tsx:49`) vs `bg-surface/50 border-edge` (`general-panel.tsx:114`, `CronJobModals.tsx:223`) | |
| BT-5 | **Destructive soft** `bg-red-600/20 text-red-400 border-red-600/50` | 9 | every integration "Clear" (`DiscordBotForm.tsx:58`, `IgdbForm.tsx:100`…), `backup-panel-modals.tsx:34` | Should be `bg-danger/10 text-danger border-danger/30` |
| BT-6 | **Destructive solid** `bg-red-600` + `disabled:bg-red-800` | 6 (admin 2 + user 4) | `BanUserModal.tsx:56`, `RoleManagementCard.tsx:50`, `delete-account-panel.tsx:55` | Disabled state is `-800` |
| BT-7 | **Ghost / text / close** | 10+ | `CronJobModals.tsx:50,148`, `EditProfessionsModal.tsx:159,216`, `AvailabilityForm.tsx:65` | Two of them are unnamed (§2 #20) |
| BT-8 | **Dead-accent fill** | 4 | §2 P1 | Invisible |
| BT-9 | **Icon-only** | 5 admin | `admin-form-helpers.tsx:32` (eye), `UserManagementRow.tsx:164`… | All have `aria-label`, which is good |
| BT-10 | **Segmented** | 9 | see RA-3 | |

Button-wide problems:
- **Focus:** no button has a focus class, so they rely on the browser's default outline.
- **Disabled:** 7 different treatments (`opacity-50/40/30`, `bg-overlay text-muted/dim`, `bg-*-800`), and about 70 buttons have none.
- **Loading:** a text swap at 61 sites, plus 5 hand-rolled spinners.
- **`type`:** 40 buttons have none, so any of them inside a `<form>` submits it. Check `AvailabilityForm.tsx` and `games-step.tsx:105,107`.

### 3.7 Labels, help, errors, required markers

| Job | Variants | Examples |
|---|---|---|
| Label typography | 5 | `text-sm font-medium text-secondary mb-1.5` (`FormTextField`), `text-xs text-muted mb-1` (Binding*), `text-xs uppercase tracking-wider text-muted` (`DynamicCategoryEditModal.tsx:81`), `text-xs font-bold uppercase` (`wow-armory-import-form.tsx:179`), inline `var(--color-foreground)` (`FeedbackDialog.tsx:80,98`) |
| Help text | 2 | `text-xs text-muted mt-1` (majority) vs `text-xs text-dim mt-1.5` (`IgdbForm.tsx:40`, `DiscordOAuthForm.tsx:37`, `SessionLengthForm.tsx:76`) |
| Field error | 5 | `text-xs/sm text-red-400` (~70 sites), `role=alert` in 3 admin sites (`BindingCreateForm.tsx:146`, `BindingConfigForm.tsx:104`, `realm-autocomplete.tsx:55`, the last being the **only** `text-danger` user), banner `bg-red-500/10 text-red-400` (`TestResultBanner`), toast-only (9 forms) |
| Required | 2 | `<span className="text-red-400">*</span>` (`create-event-form-sections.tsx:42,47`, `character-form-fields.tsx:41`, `wow-armory-import-form.tsx:161,179`, `pug-form-modal.tsx`) with no `required` attribute. Native `required` appears only in `LocalLoginForm.tsx:36,50` |
| Field wrappers that already exist | 2 | `DynamicCategoryEditModal.tsx::LabelledInput` (admin prototype), `AwayAddForm.tsx:46-58::Field` (`useId` + `htmlFor`, the best-labelled form in scope). **These are the seeds for `Field`** |

---

## 4. Proposed primitives (`web/src/components/ui`)

### 4.0 Rules for every primitive

- **Location:** flat kebab-case files in `components/ui/` (`button.tsx`, `input.tsx`, `field.tsx` …). That matches the existing inventory and the pending `switch.tsx`, so there's one import grammar (user lane conflict #4). Shared frame classes go in `components/ui/form-classes.ts`, one file.
- **The ≥3 call-site rule:** every primitive below has at least 3 sites. The one borderline case (Combobox) is flagged.
- **Colour:** token utilities only. The single exception is the **solid button fills** (`bg-emerald-600`, `bg-red-600`). They stay raw on purpose because `index.css:780-787` forces their labels white (design-system.md §2.2 DON'T, §6.10).
- **Shared field frame** (`FIELD_FRAME`):
  `w-full min-h-[44px] bg-panel border border-edge rounded-lg px-3 py-2 text-base lg:text-sm text-foreground placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-success/50 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-danger`
  - Tokens used: `--color-panel`, `--color-edge`, `--color-foreground`, `--color-dim`, `--color-success`, `--color-danger`.
  - **Focus:** the ring uses the `success` token rather than the §4.11 `emerald-500/50`. It flips per family (`#10b981` dark, `#047857` light), which the brief asked for. Pick the final alpha in the gallery so the ring clears **3:1 against `bg-panel` in both families** (WCAG 1.4.11). §6 Q6.
  - **Font:** `text-base` below 1024px stops iOS Safari zooming, and `lg:text-sm` keeps today's desktop density. The breakpoint follows §4.18 `DESKTOP_MQ`, not `sm:`/`md:`.
  - **Touch:** 44px minimum everywhere below `lg`. The only compact size is `lg:` and up.
- **Both families:** every primitive gets a `/dev/design-system` section rendered in `default-dark`, `default-light` and `sky` (§1 item 6). Native checkbox and radio chrome follows the root-only `color-scheme`, so check those **at the root**, not in the scoped side-by-side view (tokens doc §3).
- **The doc update is part of the same PR** (the keep-current rule, PR #1320): add §3.1 inventory rows, rewrite §4.11 to point at the primitives, and add a `New pattern:` line to the PR body.

### 4.1 `Button` (`button.tsx`)

- **Props:** `variant: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-soft'`, `size: 'md' | 'sm' | 'lg'`, `loading?: boolean`, `loadingLabel?: string`, `fullWidth?`, plus `ButtonHTMLAttributes` and a forwarded ref.
- **Icon-only buttons:** a discriminated union `{ iconOnly: true; 'aria-label': string }`, so TypeScript rejects an unnamed icon button.
- **`type`:** defaults to `"button"`. That fixes the 40-button form-submit hazard.

| Variant | Classes | Replaces |
|---|---|---|
| `primary` | `bg-emerald-600 hover:bg-emerald-500 text-foreground` | BT-1, BT-2 violet/indigo/amber (after Q4), BT-8 |
| `secondary` | `bg-panel border border-edge text-foreground hover:bg-overlay` | both BT-4 recipes, and the blue "Test Connection" (Q4) |
| `ghost` | `text-muted hover:text-foreground hover:bg-overlay` | BT-7 |
| `destructive` | `bg-red-600 hover:bg-red-500 text-foreground` | BT-6 |
| `destructive-soft` | `bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20` | BT-5 (9 sites) |

- **Sizes:**
  - `md` = `min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg`.
  - `lg` = `py-3 px-4`, the integration Save/Test/Clear row.
  - `sm` = `min-h-[44px] lg:min-h-9 px-3 py-1.5`, compact on desktop only.
  - `iconOnly` = `min-w-[44px]`.
- **Disabled:** `disabled:opacity-50 disabled:cursor-not-allowed` only. This retires `bg-*-800`, `opacity-30/40` and `bg-overlay text-muted/dim`.
- **Focus:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface`.
- **`loading`:**
  - Sets `aria-busy` and `disabled`.
  - Keeps the label's width: the spinner overlays the label, and the label goes `invisible`.
  - The spinner is a **private inline spinner** (`border-current border-t-transparent`), **not** the full-page `LoadingSpinner`.
- **Brand buttons** (Steam, ITAD, Co-Optimus, Discord; one site each): a `className` override that reads named constants from `lib/brand-colours.ts`. That's too few sites for a prop.

### 4.2 `Field` (`field.tsx`)

- **Props:** `{ label: string; hint?: ReactNode; error?: string; required?: boolean; hideLabel?: boolean; id?: string; children }`.
- **Mechanism:** a React **context**. `Field` generates the `id` with `useId()` and provides `{ id, describedBy, invalid, required }`. `Input`, `Select`, `Textarea`, `Checkbox` and `SearchInput` read it through `useFieldContext()` and apply `id`, `aria-describedby`, `aria-invalid` and `aria-required` automatically.
  - This is a third option between the admin lane's `cloneElement` (breaks on wrapped children) and the user lane's render-prop (boilerplate at every call site). It has the same effect as both.
- **Rendering:**
  - Label: `text-sm font-medium text-secondary mb-1.5`. With `hideLabel` it becomes `sr-only`, for search and inline table editors.
  - Required mark: `<span aria-hidden className="text-danger">*</span>`.
  - Hint: `text-xs text-muted mt-1`.
  - Error: `<p role="alert" className="mt-1 text-sm text-danger">`.
- **Dropped:** the admin lane's `labelStyle: 'caption'`, because it has only 2 sites.
- **Replaces:** all 5 label typographies, both help styles, the `text-red-400` error recipe (~70 sites), the asterisk-only required marks, and both seeds (`LabelledInput`, `AwayAddForm::Field`).

### 4.3 `Input` (`input.tsx`)

- **Props:** `InputHTMLAttributes` plus `{ invalid?; size?: 'md' | 'lg' | 'sm'; leading?: ReactNode; trailing?: ReactNode; mono?: boolean }`, with a forwarded ref.
- **Sizes:**
  - `lg` = `px-4 py-3`, the create-event density.
  - `sm` = `lg:min-h-9 lg:px-2 lg:py-1`, for inline row editors. **It stays 44px below `lg`.**
- **Classes:** `FIELD_FRAME`. `leading` adds `pl-10`.
- **Built on top of it** (moves, not rewrites): `PasswordInput` (show/hide `trailing`) and `CopyableInput` (read-only with a copy `trailing`, and now with the focus ring). Both move out of `admin-form-helpers.tsx`.
- **Replaces:** IN-1 through IN-9 (84 tags).

### 4.4 `Select` (`select.tsx`) and `Textarea` (`textarea.tsx`)

- **`Select`:**
  - Props: `SelectHTMLAttributes` plus `{ invalid?; size?; placeholder? }`.
  - Stays a **native** `<select>` (all 26 sites are native): `FIELD_FRAME appearance-none pr-9`, with a chevron icon in `text-muted`.
  - Replaces SE-1 through SE-6.
- **`Textarea`:**
  - Props: `{ invalid?; rows?; maxLength?; showCount?: boolean; resize?: 'none' | 'y' }`.
  - `FIELD_FRAME` without the min height. The counter is `text-xs text-dim` (ReasonField's logic and the FeedbackDialog/branding counters move into it).
  - Replaces all 9 textarea variants.

### 4.5 `Checkbox` (`checkbox.tsx`) and `RadioGroup` (`radio-group.tsx`)

- **`Checkbox`:**
  - Props: `{ label: ReactNode; description?; checked; onChange; disabled? }`.
  - Markup: `<label className="flex items-start gap-3 min-h-[44px] cursor-pointer">` around `<input type="checkbox" className="w-5 h-5 accent-success …focus-visible ring">`.
  - Replaces CK-2 and CK-3 (the no-op `text-emerald-500`, the hex and the dead-token boxes).
- **`RadioGroup`:**
  - Props: `{ name; value; onChange; options: {value,label,description?}[]; appearance: 'list' | 'segmented'; label }`.
  - **List** is a native radio in a 44px label row (RA-1).
  - **Segmented** is `role="radiogroup"` with `role="radio"` and `aria-checked`, arrow-key roving focus, ON = `bg-overlay text-foreground`, OFF = `text-muted` (RA-3's 9 sites, which absorbs the admin lane's proposed `SegmentedControl`).
  - `duration-picker.tsx:38`'s card grammar has 1 site. It moves to `segmented`, or stays bespoke if the operator prefers.

### 4.6 `Switch`: reuse ROK-1612 `switch.tsx`

This one isn't new. When ROK-1612 merges, migrate SW-1 and SW-2 onto it: `discord-features-page.tsx:80`, `ephemeral-voice-section.tsx:34`, `lfg-board-section.tsx:75`, `DiscordBotForm.tsx:33`, `PublicShareToggle.tsx:65`, `ephemeral-voice-toggle.tsx` (6 sites). **Its API is UNVERIFIED until it lands.** The primitives PR checks for `role="switch"`, a required accessible name, and the same focus-visible ring. Any gap is fixed in `switch.tsx`, not forked.

### 4.7 `SearchInput` (`search-input.tsx`) and `Combobox` (`combobox.tsx`)

- **`SearchInput`:**
  - Props: `{ value; onChange; label: string /* becomes aria-label */; placeholder?; onClear?; isLoading?; autoFocus? }`.
  - `type="search"`, `FIELD_FRAME pl-10`, a leading magnifier in `text-muted`, and a 44px clear button (`Button ghost iconOnly`).
  - Replaces `ModalSearchInput` (which then re-exports it) and the ~15 search sites in §3.2. This closes design-system.md §6.4.
- **`Combobox`:**
  - Props: `{ items; getKey; renderItem; onSelect; isLoading; emptyText; label; value; onQueryChange }`, built on `SearchInput`.
  - Follows the ARIA 1.2 combobox pattern: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, and ↑/↓/Enter/Esc/Home/End.
  - The listbox is `bg-surface border border-edge rounded-lg`, and the active option is `bg-overlay`.
  - Replaces `game-search-input.tsx` and `poll-game-search.tsx`, and probably `realm-autocomplete.tsx`.
  - **The ≥3 rule is borderline:** 2 sites are confirmed and `realm-autocomplete` is UNVERIFIED. I recommend building it anyway, because it's an accessibility blocker on create event, Add Character and onboarding (§6 Q1).

### 4.8 Candidates not in the core set

| Candidate | Sites | Recommendation |
|---|---|---|
| `Slider` (promote `SLIDER_CLS`) | 9 | **Include**, since it qualifies. It's a move of an existing constant, with `h-11` and a label plus `font-mono` readout |
| `FormFooter` (pinned sheet/modal footer) | 0 pinned today | **Defer to ROK-1640.** The sheet rules and `useDirtyCloseGuard` define the footer contract. Don't pre-empt them |
| `destructive-soft` as its own component | 9 | Kept as a Button variant (§4.1) |
| Label `caption` style | 2 | Dropped |
| `tone: 'info'` blue button | 8 | Dropped unless the operator rules otherwise (Q4) |

---

## 5. Migration plan

Each batch is one PR. The 107 files split into the 9 area batches **exactly once** (41 admin + 66 user).
The per-batch counts add up.

| # | Batch | Files | Size | Gate notes |
|---|---|---|---|---|
| **F** | **Fix-now** (§2) | ~30 (overlaps the batches below) | S, ~150 lines + guard test | Screenshots in `default-dark` and `default-light`. Ships the undefined-token guard |
| **P** | **Primitives**: `button`, `field`, `input`, `select`, `textarea`, `checkbox`, `radio-group`, `search-input`, `combobox`, `slider`, `form-classes.ts`, with unit tests; a `/dev/design-system` "Forms" section; design-system.md §3.1/§4.11 updates; the ratchet guard | ~14 new + 3 doc/gallery | L, ~900 lines + tests | `ui/` is a shared surface, so `scope-specs.sh` prints `ALL` and the Playwright tier runs on both projects. **Depends on ROK-1612** (`Switch`). If ROK-1612 hasn't merged, Switch adoption moves to M3 |
| M1 | **Search + combobox** (user batch 2): `modal-helpers`, `UserMenu`, `more-drawer-impersonate`, `invite-modal`, `InviteeMultiSelect`, `member-picker-modal`, `CalendarGameFilter`, `activity-modal`, `AssignmentPopupSections`, `events-mobile-toolbar`, `players-mobile-toolbar`, `events-page`, `games-page`, `players-page`, `NominateModal`, `games-step`, `game-search-input`, `poll-game-search` | 18 | L | Shared pages, so Playwright on both projects. Keyboard e2e for the combobox |
| M2 | **Admin integration forms** (admin batch 2): `DiscordBotForm`, `DiscordOAuthForm`, `IgdbForm`, `ItadForm`, `SteamForm`, `CooptimusForm`, `admin-settings-integration-cards`, `cloud-provider-card`, `ai-model-selector`, `admin-form-helpers` | 10 | M, ~250 | Collapses 5 ring hues. Blue/purple callouts become token banners |
| M3 | **Discord bindings + features** (admin batch 3): `BindingConfigForm`, `BindingConfigFormFields` (314 raw lines, so it should shrink), `BindingCreateForm`, `discord-channels-page`, `discord-features-page`, `ephemeral-voice-section`, `lfg-board-section` | 7 | M, ~200 | Switch ×3 |
| M4 | **Admin general, users, cron** (admin batches 4 and 5, minus onboarding, plus the hotfix files' remaining controls): `general-panel`, `BrandingSection`, `SessionLengthForm`, `CommunityInsightsSection`, **delete `pages/admin/branding-panel.tsx`** (no importer, per the admin lane), `BanUserModal`, `KickUserModal`, `RoleManagementCard`, `UserManagementRow`, `GameLibraryTable`, `DynamicCategoryEditModal`, `cron-jobs-panel`, `CronJobModals`, `backup-panel-modals` | 14 | M-L, ~300 (−168 deleted) | The hand-rolled overlays in the 3 cron/backup files stay out of scope (backlog) |
| M5 | **Onboarding, characters, account** (user batch 3 + admin onboarding + WoW character-create): `inline-character-form`, `character-step`, `character-form-fields`, `AddCharacterModal`, `TimezoneSection`, `AvatarUploadZone`, `avatar-panel`, `identity-panel`, `delete-account-panel`, `user-profile-components`, `LocalLoginForm`, `login-page`, `community-identity-step`, `secure-account-step`, `character-create-import-form`, `character-create-inline-import` | 16 | L | First-run and auth flows, so the **full Chrome MCP gate** applies |
| M6 | **Event create, plan, edit** (user batch 4): `create-event-form`, `create-event-form-sections`, `plan-event-form`, `plan-event-time-slots`, `reschedule-controls`, `cancel-event-modal`, `series-scope-modal`, `duration-section`, `game-details-section`, `roster-section`, `slot-stepper`, `ephemeral-voice-toggle`, `pug-form-modal`, `pug-section` | 14 | L | The heaviest raw-colour load (24 + 20 + 11) |
| M7 | **Lineups + scheduling** (user batch 5): `edit-lineup-metadata-modal`, `phase-transition-modal`, `ReasonField`, `start-lineup-presets`, `start-lineup-sliders`, `start-lineup-nomination-target`, `InstallSizeEntryModal`, `share-eta-row`, `PublicShareToggle`, `SchedulingSuggestForm`, `lineup-channel-override-select`, `create-poll-modal`, `duration-picker`, `min-vote-threshold-slider`, `CommonGroundFilters`, `coop-filter-controls` | 16 | M | Sliders move to `Slider`. `lineups/standalone-poll` or scheduling paths trigger Discord smoke review |
| M8 | **Filters, availability, feedback** (user batch 6 + the feedback pair): `play-history-select`, `playtime-min-input`, `role-select`, `source-multi-select`, `AvailabilityForm` (also moves onto `Modal`, §4.4), `AwayAddForm`, `FeedbackDialog`, `FeedbackWidget` | 8 | S | |
| M9 | **WoW plugin** (the rest of admin batch 6): `wow-armory-import-form`, `realm-autocomplete`, `EditProfessionsModal`, `event-create-content-browser` | 4 | S-M | `realm-autocomplete` moves to `Combobox` if it qualifies |
| G | **Dirty-close rollout** (after ROK-1640 merges `useDirtyCloseGuard`): the 15 Modal forms (`pug-form-modal`, `AddCharacterModal`, `NominateModal`, `create-poll-modal`, `cancel-event-modal`, `edit-lineup-metadata-modal`, …) | ~15 | M | Fold into M5–M7 if ROK-1640 lands first |

**Totals:** 12 PRs (F, P, M1–M9, G). File counts: 18+10+7+14+16+14+16+8+4 = **107**.

**Recommended order:** F → P → M1 → M5 → M6 → M7 → M8 → M2 → M3 → M4 → M9 → G. That's user-facing first, with the biggest accessibility wins (search and the combobox) leading. Admin screens have one operator audience, so they go last (Q8).

### Stopping regressions

1. **Undefined-token guard** (ships in F): `styles/undefined-tokens.guard.test.ts`, described in §2 #27. It fails on any `--color-*` or utility that `index.css` doesn't declare.
2. **Raw-control ratchet** (ships in P): `styles/form-primitives.guard.test.ts`.
   - It scans `web/src/**/*.tsx`, stripping comments first and excluding `components/ui/**`, `dev/**` and tests.
   - It looks for `<input` / `<select` / `<textarea` / `<button` with a literal `className=`, and compares the hits to a checked-in allowlist of files not yet migrated. That list starts with all 107 plus any stragglers.
   - **The allowlist can only shrink.** A new file with a raw control fails, and so does an allowlisted file that no longer needs its entry (so the list is kept tidy).
   - Each M-batch deletes its rows, and after the last batch the list is empty.
   - A source-scan test is better here than a custom ESLint rule: the repo already uses the guard-test pattern (`semantic-tokens.guard.test.ts`), and a ratchet is easier to express as data.
   - Exemptions such as `type="hidden"`, `type="file"` and `type="color"` are listed explicitly.
3. **`text-red-400` in error copy**: the ratchet also flags `text-red-400` in any file that imports `Field`.

---

## 6. Open questions for the operator

| # | Question | Recommendation | Why |
|---|---|---|---|
| Q1 | **Combobox: build it in-house or adopt a headless library** (Downshift `useCombobox`, React Aria, Headless UI)? | **In-house.** It's the only one with 2–3 sites | No headless library is in `web/package.json` (verified here). The repo already hand-builds menu keyboard handling (`SchedulingManageDropdown`, design-system.md §4.14). The ARIA 1.2 pattern is ~150 lines plus a keyboard test. Revisit if a second popup primitive (date picker, multi-select) turns up |
| Q2 | **One `Button` API or several** (Button / IconButton / LinkButton)? | **One `Button`**, with `iconOnly` as a typed union that requires `aria-label`. Link-styled actions stay `<Link>` | Five variants and three sizes cover all 201 sites. A split doubles the surface for ~5 icon buttons |
| Q3 | Is `destructive-soft` a fifth variant? | **Yes** | 9 admin "Clear" buttons use it (the brief lists four variants) |
| Q4 | **Retire the extra primary hues?** Blue "Test Connection" (8), violet plan/reschedule/cancel (6), purple AI (4), and the per-integration focus-ring hues | **Yes.** Blue becomes `secondary`, violet and purple become `primary`, and all focus rings become `success` | §2.2 hue roles. Focus is the one state that has to be consistent. The operator owns the violet "plan" CTA ruling |
| Q5 | **Field radius:** `rounded-lg` (§2.5, 155 admin uses) or `rounded-md` (§4.11)? | **`rounded-lg`**, and rewrite §4.11 in the primitives PR | It's the majority and it matches buttons. The doc contradicts itself today |
| Q6 | **Focus ring colour:** the `success` token or raw `emerald-500/50` (§4.11)? | **`ring-success`**, with the alpha tuned in the gallery to ≥3:1 on `bg-panel` in both families | The brief asks for a token ring. The token darkens on light, which is where `/50` is weakest |
| Q7 | **`--color-accent`:** declare the token or replace its ~25 call sites? | **Replace**, and add the guard | "Accent" has no meaning distinct from `success`/emerald. A declared token wouldn't join the forced-white list, so solid fills would still need `bg-emerald-600` |
| Q8 | **Migration order:** user-facing first or admin first? | **User-facing first** (M1, M5–M8), then admin (M2–M4, M9) | Most users and phone-first surfaces (iOS zoom) come first. Admin has one audience |
| Q9 | **Toast-only validation** (9 forms): move required-field errors inline through `Field`? | **Yes.** Inline for field errors, toast only for server/result errors | design-system.md §4.8 already says an error the user must act on belongs inline |
| Q10 | Should `Slider` join the primitives PR? | **Yes** | It has 9 sites, and it's a move of `SLIDER_CLS` |
| Q11 | Should `duration-picker`'s card radio become `segmented`? | **Yes**, unless the card grammar is wanted | It has 1 site, below the rule |

---

## 7. Draft follow-up stories (not filed)

**S1: `fix: forms — invisible buttons, undefined tokens, unlabelled fields, missing focus` (Bug; batch F)**
- The four P1 buttons render a visible filled control, with a readable label in `default-dark`, `default-light` and `sky`.
- `web/src` has no `*-accent`, `--color-accent`, `--color-border`, `ring-primary`, `bg-base` or `text-primary`, and `undefined-tokens.guard.test.ts` fails on a reintroduced one (mutation-checked).
- Every §2 P3 control has an accessible name (`id`+`htmlFor` or `aria-label`), and `LocalLoginForm`'s error is `role="alert"`.
- Every §2 P4 control shows a visible focus ring on keyboard focus.
- The §2 #28 phone inputs are `text-base` below `lg`.

**S2: `feat(ui): form primitives — Button, Field, Input, Select, Textarea, Checkbox, RadioGroup, SearchInput, Combobox, Slider` (batch P)**
- Each primitive exists in `web/src/components/ui/` with unit tests covering the ARIA wiring (`Field` → `aria-invalid`, `aria-describedby`, `aria-required`; Button `loading` → `aria-busy`; the combobox keyboard contract).
- They use only token classes, apart from the documented solid-fill exception. Focus is `focus-visible` on a token ring. Fields are `text-base lg:text-sm` and 44px minimum below `lg`.
- `/dev/design-system` has a "Forms" section, verified in `default-dark`, `default-light` and `sky` at the root.
- `docs/design-system.md` §3.1 and §4.11 are updated, and the PR body carries the `New pattern:` lines.
- `form-primitives.guard.test.ts` ships with the 107-file allowlist.

**S3: `tech-debt: migrate search inputs and game search onto SearchInput / Combobox` (M1, 18 files)**
- Every search box has an accessible name and a 44px clear affordance, and `ModalSearchInput` delegates to `SearchInput`.
- Game search in create event, Add Character and onboarding can be operated fully by keyboard (↑/↓/Enter/Esc), with a Playwright spec on both projects.
- The 18 files are removed from the ratchet allowlist.

**S4: `tech-debt: migrate onboarding, character and account forms onto form primitives` (M5, 16 files)**
- Every field is wrapped in `Field`, and password mismatch and other inline errors set `aria-invalid`.
- `disabled:bg-*-800` is gone, and buttons use `Button`.
- The full Chrome MCP gate passes on the first-run flow in both families.
- The 16 files are removed from the allowlist.

**S5: `tech-debt: migrate event create/plan/edit forms onto form primitives` (M6, 14 files)**
- Required fields carry `required` and `aria-required`, and the asterisk comes from `Field`.
- Raw-hue counts in `create-event-form-sections` and `plan-event-time-slots` drop to the solid-fill exception only.
- The files are removed from the allowlist, and the Playwright create-event spec passes on both projects.

**S6: `tech-debt: migrate lineup and scheduling forms; sliders onto Slider` (M7, 16 files)**
- All 9 ranges use `Slider` (44px, labelled, with a readout).
- `edit-lineup-metadata-modal`'s "Title is required" shows inline, not only as a toast.
- The Discord smoke suite is reviewed and green where scheduling or standalone-poll paths change. The files are removed from the allowlist.

**S7: `tech-debt: migrate player filters, availability and feedback forms` (M8, 8 files)**
- The filter selects are 44px and labelled, and `playtime-min-input` follows the §4.11 family rule.
- `AvailabilityForm` renders in `Modal`, with no hand-rolled header.
- `FeedbackDialog` uses `Textarea` (with its counter), `RadioGroup` segmented for the category, and `Button`.

**S8: `tech-debt: migrate admin integration and Discord binding forms onto form primitives` (M2 + M3, 17 files; can split)**
- The Save/Test/Clear triad uses `Button` `primary`/`secondary`/`destructive-soft`, with no per-integration ring hues.
- The three `sr-only peer` switches and `DiscordBotForm`'s switch use the ROK-1612 `Switch`.
- `BindingConfigFormFields.tsx` is ≤300 counted lines.

**S9: `tech-debt: migrate admin general, user-management and cron forms; delete dead branding-panel` (M4, 14 files)**
- `pages/admin/branding-panel.tsx` is deleted after an importer check.
- The ban/kick/role modals use `Checkbox`, and `DynamicCategoryEditModal` uses `Field`, which retires `LabelledInput`.
- The files are removed from the allowlist.

**S10: `tech-debt: migrate WoW plugin forms` (M9, 4 files)**
- The region picker uses `RadioGroup` segmented, with no `text-blue-300/400`.
- `realm-autocomplete` uses `Combobox` if its semantics qualify. Otherwise it gets `SearchInput` with a documented reason.
- The allowlist is empty, and the ratchet asserts that it stays empty.

**S11: `feat: dirty-close guard on modal forms` (G; blocked by ROK-1640)**
- The 15 Modal/BottomSheet forms confirm before a backdrop tap, Esc or back gesture discards changes.
- The primary action sits in a pinned footer outside the scroll body (ROK-1640 sheet rules).
- An integration or Playwright test covers dismissing a dirty form in `AddCharacterModal` and `pug-form-modal`.

---

## Verification notes

- **Verified here, at `fadd12ff0`:**
  - No `--color-accent`, `--color-border`, `--color-primary` or `--color-base` exists in `index.css`.
  - The anchor-offset spot checks in the Provenance table hold.
  - `backup-panel-modals.tsx:135` uses `text-accent`, not white.
  - `text-primary` appears in 8 files.
  - `text-red-400` has 154 uses in `web/src`, against 2 for `text-danger`.
  - `LoadingSpinner` is full-page.
  - No headless UI library and no `@tailwindcss/forms` is installed.
- **Taken from the lanes without re-checking:** every other `file:line`.
- **Flagged:** `realm-autocomplete`'s combobox semantics (UNVERIFIED); the ROK-1612 `Switch` API (UNVERIFIED until merged); the `text-red-400` contrast figure (lane conflict); whether PR #1318 covers `text-amber-300` and `text-blue-300/400` (§2 #29).
- **Not reached:** a per-file raw line budget for the M-batches (sizes are the lanes' rough estimates), and whether each of the 40 untyped buttons actually sits inside a `<form>`.

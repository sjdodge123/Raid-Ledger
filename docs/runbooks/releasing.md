# Releasing — when a version number is allowed to move

> ROK-1475. The rule below is **enforced by CI**, not remembered:
> `scripts/check-feat-since-tag.sh` runs as a pre-flight in `.github/workflows/release.yml`
> and as a warn-only notice in `.github/workflows/docker-publish.yml`.

## The rule

**A new version number means "something new shipped."** Cut a `vX.Y.Z` tag only when at least one
**feature-class** commit landed since the previous `v*` tag. A span of nothing but `fix:`, `chore:`,
`perf:`, `docs:` and `test:` commits does **not** get a version — those changes reach self-hosters
through the image, which is rebuilt on every push to `main`.

The failure this prevents: a version bump that announces itself to every instance's admin panel and
turns out to carry nothing a user would notice. Version noise trains people to ignore the banner, and
then a release that *does* matter gets ignored with it.

## Two signals, two meanings

| Signal | Answers | Moves when | Where it comes from |
|---|---|---|---|
| **Version** (`v1.2.0`) | "Is there something new worth caring about?" | A `feat:`/breaking commit shipped | A human dispatches `release.yml` |
| **Build** (`:main` image / commit sha) | "Am I missing fixes?" | Every push to `main` | `ci.yml` pushes `ghcr.io/…:main` |

So a fix-only week produces **no** new version and **several** new builds — and that is the intended
outcome, not a gap. Pulling `:main` (Watchtower does this automatically) is how fixes arrive.

> **Coming in a later PR (ROK-1475 S3/S4), not shipped yet:** a build-level *"N fixes available"*
> signal in the admin panel, so an instance running an older build can see that fixes exist without a
> version number having to move. Until that lands, the admin update banner is version-level only.
> Do not document it to users as though it exists.

## What counts as feature-class

Matched against the **full commit body** (`%B`) of every commit in `<prev v* tag>..<ref>`:

| Input | Verdict | Why |
|---|---|---|
| `feat: …` / `feat(scope): …` | **feature** | The conventional-commits feature type. |
| `fix(events) + feat(lfg-board): …` | **feature** | Real squash subjects carry two types; the regex is **not** anchored to `^`. |
| `feat!: …` / `feat(scope)!: …` | **feature** | See breaking changes below. |
| `BREAKING CHANGE:` / `BREAKING-CHANGE:` anywhere in a commit **body** | **feature** | The footer form, and it counts even under a `fix:`/`chore:` type. |
| `chore: combined merge …` whose body lists `feat(…)` lines | **feature** | The body is scanned, not just the subject. |
| `feature: …`, `featured games page`, prose containing "feat" | **not** a feature | The colon (optionally after `(scope)`/`!`) is required. |
| Nothing but `fix:`/`chore:`/`perf:`/`docs:` | **not** a feature | This is the case the gate exists for. |
| No previous `v*` tag at all | **allowed** | You cannot bootstrap a first release otherwise; prints `first-tag: …`. |
| Non-`v` tags (e.g. `rok1565-prerebase-backup`) | ignored | `git describe --match 'v*'`. |

### Breaking changes

**A breaking change is always feature-class**, even when its commit type is `fix:` or `chore:`.
It forces a **major** bump (`major` in the `release.yml` dispatch), and its release notes must say what
broke and what a self-hoster has to do about it. A breaking change is exactly the kind of thing a
version number exists to announce — never ship one as a silent `:main` build.

## The escape hatch — `allow_no_feat`

`release.yml`'s `workflow_dispatch` has a boolean input **`allow_no_feat`** (default `false`). Tick it
and the pre-flight is skipped, with a loud `::warning::` annotation and a step-summary block naming the
actor who overrode it.

Legitimate reasons to tick it:

- A **security-only** release that has to be citable by version number.
- **Re-cutting a botched tag** (wrong sha, failed publish) where the features were in the previous span.
- A **version-metadata-only** release the operator has explicitly asked for.

"I want to ship today" is not one. The hatch exists so the gate is honest — a gate people route around
by editing the workflow is worse than no gate.

## Running the check by hand

```bash
bash scripts/check-feat-since-tag.sh                     # would HEAD be a legitimate release?
bash scripts/check-feat-since-tag.sh --ref v1.1.0 --mode warn   # audit an existing tag
```

```
exit 0  feature-class commit found in (previous v* tag .. ref], OR no previous v* tag, OR --mode warn
exit 1  --mode fail and the span has no feature-class commit
exit 2  usage error / not a git repo / unresolvable --ref
```

It always prints `prev-tag:`, `span: <a>..<b> (N commits)` and `match: <subject>|NONE`, so a CI log
answers *why* without a re-run.

**Where the previous tag is described from depends on what `--ref` is:**

- `--ref` names an existing `v*` tag (the `docker-publish.yml` notice, running *on* the new tag) →
  described from that tag's **parent**, so it resolves the tag *before* this one rather than itself.
- anything else, including the default `HEAD` (the `release.yml` pre-flight) → described from the ref
  **itself**. If `HEAD` already carries a `v*` tag, the span is therefore **empty** and the guard
  fails. Describing from `HEAD^` here would skip that tag and re-scan the previous release, where an
  old `feat:` would happily authorise a second, no-op version bump.

Both workflows check out with `fetch-depth: 0` and `fetch-tags: true`. A shallow checkout has no tag
history, so the script **exits 2** naming `fetch-depth: 0` rather than degrading to the permissive
`first-tag:` path — if you add another job that calls the script, carry those two settings with it.

## Cutting a release

1. Confirm the span earns it: `bash scripts/check-feat-since-tag.sh` on an up-to-date `main`.
2. Run the **Release** workflow (`workflow_dispatch`) from `main` with `patch` / `minor` / `major`
   (`major` for any breaking change). Leave `allow_no_feat` unticked. A dispatch from any other ref
   fails at its first step.
3. The pre-flight runs *before* anything is tagged or pushed — a failure there leaves no tag and
   nothing to clean up. The workflow then derives the version from tags, not from a file:
   `scripts/next-release-version.sh` bumps the highest existing `vX.Y.Z` tag (pre-release and other
   tags are ignored) and refuses a version whose tag already exists. It creates an annotated tag on
   `main`'s HEAD and pushes **only the tag** — there is no version-bump commit, because protected
   `main` refuses a push made with `GITHUB_TOKEN`. A published image reports its version from the
   `APP_VERSION` build arg baked from the tag; `api/package.json` is only the local-dev fallback.
4. A tag pushed with `GITHUB_TOKEN` does not fire push-event workflows, so **Release** then dispatches
   **Publish images** (`docker-publish.yml`) on the new tag. That builds `Dockerfile.allinone`, pushes
   the tagged images and creates the GitHub release. Its warn-only notice re-checks the span. A tag
   pushed **by hand** with your own credentials (bypassing `release.yml`) still triggers Publish
   images through its `push` trigger, so it too gets images, a release and a visible annotation.

**Publish images** (`softprops/action-gh-release`) is the only creator of the GitHub release: the
Quick Deploy body first, then the generated notes.

## Tests

`scripts/test/check-feat-since-tag.test.sh` (36 assertions) covers the matching table above against
throwaway git repositories. It is discovered by `scripts/test/run-all.sh`, which GitHub CI runs in the
`lint` job — so a change to the matching rules that breaks the table fails on the PR.

`scripts/test/next-release-version.test.sh` covers the version computation the same way: patch /
minor / major from the highest `vX.Y.Z` tag, numeric ordering (`v1.10.0` beats `v1.9.0`), pre-release
and non-semver tags ignored, the highest tag winning even when HEAD cannot reach it, and exit 2 on
no tags or a bad argument. It is discovered by `run-all.sh` in the same `lint` job.

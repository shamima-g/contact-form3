---
name: build-report-effort
description: Generate the build-effort report — how long and how much each story cost to build, grouped by screen type (listing / form / record action / detail / auth / export) and rolled up per feature (epic), with a calculator for sizing a new feature from those benchmarks. Built from the workflow's own per-story timestamps and token logs. Opens it in the browser.
---

You are generating the **build-effort report**: a self-contained HTML page that answers two questions from data the workflow already records, with no manual instrumentation:

1. **Per screen type** — roughly how many minutes and how many tokens does each *kind* of screen take? A listing page vs a create/edit form vs a record action, etc.
2. **Per feature, and for the next feature** — what did each delivered feature (epic) add up to, and what should a new one of a given shape be expected to cost? The page rolls the story rows up to the epic level and carries an in-page calculator that turns a screen mix into a time and cost estimate.

**Two ground-truth inputs, same as `/build-report-cost`:**

- **Time** — each story's `startedAt` → `completedAt` in `generated-docs/epics/<slug>/state.json`. This is the per-story BUILD window (test generation + implementation + that story's E2E); it excludes PLAN, epic-end, manual test and PR.
- **Token cost** — every assistant message (orchestrator **and** sub-agents) under `~/.claude/projects/<project-slug>/`, bucketed into the story window containing its timestamp, priced with the shared table in `.claude/scripts/lib/report-core.mjs` (list API prices; cache read 0.1×, write 1.25×/2×).

Story **titles** (and therefore the screen-type classification) come from the Playwright spec filenames `web/e2e/epic-<slug>-story-<N>-<title>.spec.ts`.

Everything the skill needs lives beside this file plus the shared core:

- `generate-build-effort.mjs` — reads the inputs above, buckets tokens per story, classifies by screen type, rolls the stories up per epic, and writes `generated-docs/reports/build-effort.html` and `build-effort-data.json`.
- `.claude/scripts/lib/report-core.mjs` — the shared pricing table + transcript reader (also intended to back `/build-report-cost`).

## Step 1 (optional): exchange rate

The report shows USD by default. To also show ZAR, fetch the rate and pass it with `--rate`:

```bash
curl -s --max-time 15 "https://open.er-api.com/v6/latest/USD"
```

## Step 2: decide which sessions to exclude

Like `/build-report-cost`, the script reads **every** session transcript for the project. Sessions that are *about* the project rather than part of the build — analysis chats, `/build-report-*`/`/dashboard` runs — should be excluded so they don't inflate the overhead/total figures:

```bash
ls ~/.claude/projects/<project-slug>/*.jsonl
```

Pass the unrelated ones with `--exclude=<id1>,<id2>`. (Per-story cost is unaffected — those sessions fall outside story windows — but the totals are cleaner without them.)

## Step 3: run the generator

```bash
node .claude/skills/build-report-effort/generate-build-effort.mjs --rate=<ZAR_RATE> --exclude=<id1>,<id2>
```

The script prints a compact summary JSON: stories, epics, median minutes/story, per-type medians (marginal **and** fully loaded), the per-epic roll-up, the two uplift factors, and the typical-epic benchmark. Watch for:

- **`costComplete: false` + `WARNING: no sub-agent transcripts found` / low coverage** — the project's sub-agent token logs weren't captured (e.g. an older log format), so per-story cost can't be reconstructed. The report renders **time-only** and says so. Do **not** present token-cost figures in this case; report build time and tell the user cost was unavailable.
- **`WARNING: unknown models priced as Opus 4.8`** — a model appeared that isn't in `report-core.mjs`'s `PRICING`. Look up its real price (the `claude-api` skill has the table), add it to `PRICING` in `report-core.mjs`, and re-run.
- **No epics / no dated stories** — the workflow hasn't produced stories with start/complete timestamps yet; tell the user there is nothing to report.

## Step 4: open the report

```bash
start "" "generated-docs/reports/build-effort.html"
```

## Step 5: summarise for the user

Give a short summary from the exact figures, at the level the user will actually plan with:

- **The typical feature** — median stories, build time and fully-loaded cost per epic. This is the headline number for "what does a feature like this cost".
- **The spread across features** — the cheapest and most expensive epic, and what drove the gap (usually its screen mix and any rework).
- **The per-screen-type rule of thumb** — which kinds are cheap vs expensive, quoting the fully-loaded figure since that's the one that budgets.
- **Marginal vs fully loaded** — only ~¼–⅓ of spend lands inside story windows; the rest is workflow scaffolding (INTAKE, PLAN, epic-end E2E + fixes, PR/merge). Say the uplift factor out loud (e.g. "×3.7"), and that per-feature loaded figures are that overhead allocated pro-rata, not measured per feature.
- **How to size the next feature** — point at the *Size a new feature* calculator on the page: enter the screen counts, read off build time and fully-loaded cost. Note that types marked `n=1` rest on a single measurement.

## Methodology notes (do not silently change these)

- **Ground truth only.** Time from `state.json`; tokens/cost from transcripts via the shared reader; deduped by message id; `<synthetic>` messages skipped. Nothing is estimated.
- **Overlapping story windows are split, not first-match.** Epics built in parallel (separate branches/worktrees) have story windows that overlap, so a message can fall inside several. Its cost is divided evenly across every story in flight at that instant — first-match-wins would pile all concurrent spend onto whichever story started earliest and, at the feature level, quietly drain one epic into another. The share of story spend that was ambiguous is reported (`ambiguousSharePct`), the parallel-built epics are listed, and the page banners it above 5%. Splitting conserves the total, so project and per-type figures are unaffected by the choice; only the per-feature split is softened. Don't "simplify" this back to `.find()`.
- **Cost completeness is coverage-based.** Cost is treated as trustworthy only when sub-agent transcripts exist **and** most stories (≥60%) have token records bucketed into them. Below that it degrades to time-only rather than publishing wrong dollar figures — this is the correct behaviour for older/partial logs, not a bug.
- **Overhead** = spend outside all story windows (INTAKE, PLAN, epic-end, PR, orchestrator context between stories). Reported separately; the "fully-loaded per story" figure divides the whole total by story count.
- **Feature (epic) roll-up.** An epic *is* the feature here, so the epic level is where a new feature gets estimated. Story time and cost sum straight up. Two derived numbers sit alongside them:
  - **`costUplift` = total spend ÷ in-story spend.** Each epic's fully-loaded cost is its measured marginal cost × this factor. The logs can't attribute overhead to a single epic — in a one-session build the overhead messages sit between story windows with nothing tying them to an epic, and epics built in parallel worktrees overlap in time — so it is allocated pro-rata to measured story spend and **labelled as an allocation** on the page and in the footer. Don't present it as measured. (Session-based attribution was tried and doesn't work: a whole 8-epic build commonly runs in one session.)
  - **`timeUplift` = summed epic elapsed ÷ summed story minutes**, where an epic's elapsed span is first story start → last story end. It captures the gaps *between* stories only; PLAN and epic-end carry no timestamps, so treat the calculator's elapsed figure as a floor, not a delivery date.
- **The estimator is deliberately dumb.** It multiplies the per-type medians by the counts the user types in — no curve-fitting, no complexity weighting. That keeps it auditable against the tables directly above it. If a type's `n` is 1–2 the page flags it; keep that flag.
- **Classification is title-based**, first-match-wins, from the `TAXONOMY` table at the top of the script — never the epic slug (an epic named `…-export` must not tag its listing stories as Export). Tune the taxonomy there.
- **Single project, directional.** Small n per screen type (often 1–5), and n per project at the epic level is small too (8 epics here). These firm up as more projects are measured; per-story **and** per-epic rows are emitted to `build-effort-data.json`, alongside a `benchmarks` block, so a future cross-project pooling step can accumulate them at either level.
- **AI build effort only.** Excludes human review / manual-test wall-time and permission-prompt waits (not recorded in transcripts).

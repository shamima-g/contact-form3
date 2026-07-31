---
name: build-report-all
description: Generate all four build reports in one pass — cost, effort, the maintainer retrospective and the client-facing delivery report — resolving the exchange rate and session exclusions once so the four agree with each other. User-triggered; it regenerates every report, so don't run it to answer a question one report already answers.
---

You are generating **all four build reports** in a single pass:

| Report | Page |
|---|---|
| Cost | `generated-docs/reports/build-cost.html` |
| Effort | `generated-docs/reports/build-effort.html` |
| Maintainer retrospective | `generated-docs/reports/build-report.html` |
| Client-facing delivery report | `generated-docs/reports/build-report-stakeholders.html` |

**Why this exists, and why it isn't just four invocations.** The four overlap: both audience reports refresh the cost data as their own first step, and the maintainer report's cost panel reads it. Running the four skills back to back would regenerate that data three times, ask you for the exchange rate and the session exclusions up to four times, and — worst — risk the four pages disagreeing because they were built from different snapshots or different exclusion lists. This skill resolves the shared inputs **once** and runs the four in dependency order.

Everything here is **display-only**: never modify workflow state, run tests, or resume the workflow.

## Step 1: Resolve the shared inputs — once

**Exchange rate.** Fetch it once and reuse it for every step that takes one:

```bash
curl -s --max-time 15 "https://open.er-api.com/v6/latest/USD"
```

Extract `ZAR`. If the fetch fails, carry on without a rate — the pages say they used a placeholder.

**Session exclusions.** Work out the list now, using the *"Exclude sessions that aren't part of the build"* bullet in [build-report-procedure.md](../../shared/build-report-procedure.md) **Step A** — that bullet only, not the rest of Step A: **don't run the cost generator here.** Step 2 is the single place it runs. Then **use the same `--exclude` list for every report below.** Two reasons this matters more here than in a single report: a different list per report makes the four disagree, and an analysis conversation left in surfaces on the client-facing page as a product decision the client never made.

**Team name.** Read `generated-docs/reports/report-meta.json`. If it has no `team`, ask once (as `/build-report-maintainer` Step 1 describes) and save it — the maintainer page needs it and you don't want to interrupt again later.

## Step 2: Cost — first, because the others read its output

```bash
node .claude/skills/build-report-cost/generate-build-cost-report.mjs --rate=<ZAR_RATE> --exclude=<ids>
```

This writes `build-cost-data.json`, which Steps 4 and 5 depend on. **Don't skip or reorder it.**

It exits non-zero for two very different reasons, so read the **message**, not the exit code:

- `No epics found at generated-docs/epics/…` or `No readable epic state.json…` — there's no project to report on. Say so, suggest `/start`, and **stop**: the three remaining steps would each fail the same way.
- `Transcript directory not found…` — the build happened on another machine. **Continue.** The other three reports still render; the cost panel and the sign-off section simply drop out.

Watch for the warnings the cost skill documents: unknown models priced at Opus rates (the figures are then estimates, not exact) and skipped epics with no valid timestamp.

## Step 3: Effort

```bash
node .claude/skills/build-report-effort/generate-build-effort.mjs --rate=<ZAR_RATE> --exclude=<ids>
```

If it reports `costComplete: false`, the project's sub-agent token logs weren't captured — report build time only and say cost was unavailable, exactly as `/build-report-effort` instructs. Don't present per-story cost figures in that case.

## Step 4: Maintainer retrospective

Follow [build-report-procedure.md](../../shared/build-report-procedure.md) **Steps B to D** with `--audience maintainer`, the *Writing the insight panel* brief in `/build-report-maintainer` and its output `generated-docs/reports/build-report-insights.md`.

**Skip Step A** — the cost data is already fresh from Step 2. Re-running it would waste a pass and re-ask you for the rate and the exclusions, and a second snapshot is exactly what makes this page's cost panel disagree with the cost report itself.

## Step 5: Client-facing delivery report

Follow [build-report-procedure.md](../../shared/build-report-procedure.md) **Steps B to D** with `--audience stakeholders`, the *Writing the insight panel* brief in `/build-report-stakeholders` and its output `generated-docs/reports/build-report-insights-stakeholders.md` — and **also** curate the sign-off log exactly as that skill's Step 2 describes, writing `generated-docs/reports/build-report-decisions.json`.

**Skip Step A** here too, for the same reason.

## Step 6: Open

Opening four tabs is a lot. Open the two **audience** pages, and print the paths of the other two:

```bash
start "" "generated-docs/reports/build-report.html"
start "" "generated-docs/reports/build-report-stakeholders.html"
```

Then tell the user the cost and effort pages are at `generated-docs/reports/build-cost.html` and `generated-docs/reports/build-effort.html`. If they asked for a specific one, open that instead.

## Step 7: Confirm — one summary, not four

Give a short combined read, not a per-report recital:

- **Delivery** — epics/stories delivered and first-pass test yield.
- **Effort and cost** — active build time vs calendar span, total in ZAR, and the typical cost per story from the effort report.
- **Involvement** — decisions asked for and the typical (median) answer time.
- **One notable pattern** — the biggest time-sink, or the most expensive feature area.

Then, in one clause each: any sessions you excluded, and any report that degraded (missing cost data, estimated pricing, incomplete sub-agent logs). Mention that each report's written panel is shaped by a brief inside its own skill, and that `/build-report-cost` and `/build-report-effort` exist for a single report when the full set is overkill.

## DO / DON'T

Both lists in [build-report-procedure.md](../../shared/build-report-procedure.md) apply. Two additions specific to running all four:

- **DO** use one exchange rate and one exclusion list across all four, so the pages agree.
- **DON'T** refresh the cost data more than once — Step 2 is the only place it runs.

## Related

- `/build-report-cost`, `/build-report-effort` — a single report when you don't need the set
- `/build-report-maintainer`, `/build-report-stakeholders` — one audience at a time
- `/status`, `/dashboard`, `/quality-check`

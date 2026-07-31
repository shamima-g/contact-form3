---
name: build-report-maintainer
description: Generate the maintainer build report — how long the app took (calendar span vs. active build time), what it cost, how efficiently the workflow ran (first-pass test yield, rework share, velocity per story), what got produced, and where time was lost, as a visual page. For the client-facing version use /build-report-stakeholders.
---

You are producing the **maintainer build report**: a visual, interactive retrospective of how
this application came together — how long it took (calendar time vs. actual active build time),
what it cost (exact token/cost figures from the session logs), how efficiently the workflow ran
(first-pass test yield, rework share, velocity per story), how much the user had to step in
(deliberate inputs, and how long the process sat waiting for them), what got produced (code,
components, tests), where time was lost, and the stumbling blocks along the way. It opens in the
browser like `/dashboard`.

This is the **internal** report — it shows the machinery. For a client or sponsor, use
**`/build-report-stakeholders`** instead.

The report has two layers:

- **Metrics, timeline, build flow (story swimlanes & parallelism), cost & user involvement,
  workflow performance, quality-gate history, codebase stats, per-epic effort, stumbling blocks,
  data quality** — computed deterministically from git history, the workflow's own files
  (`state.json`, `journal.md`, `template-feedback.md`, tracked files under `web/`), the
  session-log cost data, and the quality-gate run log. You don't write these; the generator does.
- **A “What this means” insight panel** — a short plain-language read on the data that you write
  by following the brief below. This is the only part you author.

## This report's parameters

| | |
|---|---|
| **Audience flag** | `--audience maintainer` (the default — the flag may be omitted) |
| **Page** | `generated-docs/reports/build-report.html` |
| **Insight file** | `generated-docs/reports/build-report-insights.md` |
| **Insight brief** | the *Writing the insight panel* section below |
| **Exchange rate** | **Required** — this page shows cost in ZAR |

## Step 1: Team name — ask once

Read `generated-docs/reports/report-meta.json`. If it exists with a `team` value, use it and move
on. If not, ask the user (via `AskUserQuestion`, one question): *"Which team or group name should
appear on this report? (It makes reports from different teams comparable side by side.)"* — offer a
**Skip** option; they can type a name via *Other*. If they give a name, write
`{"team": "<name>"}` to `generated-docs/reports/report-meta.json`; if they skip, write
`{"team": null}` so they aren't asked again.

## Step 2: Get the USD→ZAR rate

```bash
curl -s --max-time 15 "https://open.er-api.com/v6/latest/USD"
```

Extract `ZAR` and pass it as `--rate` in the next step. If the fetch fails, proceed without
`--rate` — the report uses a placeholder rate and says so.

## Step 3: Run the shared procedure

Follow **[build-report-procedure.md](../../shared/build-report-procedure.md)** from Step A to
Step F, using this report's parameters from the table above.

## Writing the insight panel

This is the brief the shared procedure's Step C refers to. **Change the wording below to change
what the panel says** — shift the focus (cost vs. quality vs. speed), change the tone, or add a
question you always want answered. It takes effect the next time you run this command.

> **`/upgrade` replaces this file**, so edits here last until the next template update, not beyond.
> If you want wording that survives, keep a copy of your version somewhere in the project and
> re-apply it after upgrading.

Read `generated-docs/reports/build-report-data.json` (the computed metrics), each epic's
`journal.md`, and `generated-docs/template-feedback.md` (the narrative), then write the summary to
`generated-docs/reports/build-report-insights.md` — that file only, nothing else in it. The
generator injects it as the top panel.

Write for **someone evaluating how well the build process performed** — they want an honest
verdict, not a celebration. Plain language; any ratio you cite must be explained in the same
sentence. Base every claim on the data; never invent numbers or events.

Aim for **4 short sections**, roughly 300–450 words total:

1. **The verdict** — one short paragraph: how long it really took (calendar span vs. active build
   time — note the active figure is a floor estimated from commit timing), what it cost when the
   data has a `costEffort` block (the Rand figure), how much the user had to step in (decisions
   asked for, their typical answer time, and how many phases ran unattended — describe waits as
   time the process sat idle for input, never as the user's working time, which isn't recorded,
   and prefer the median answer time to a sum of waits), what got delivered (epics, stories, and
   the size/shape of the codebase), and a one-phrase overall verdict on how smoothly it went.

2. **Efficiency read** — 2–4 bullets interpreting the workflow-performance numbers. Anchor on:
   the **first-pass E2E yield** (what share of stories worked without a fix cycle, and whether
   the failures cluster in one epic or spread out), the **rework share** (fix commits and the
   share of changed lines they account for — heavy fixing of few lines vs. broad rewrites read
   very differently), and **velocity** (active time per story — call out the epics well above or
   below it and why, using the journals).

3. **Where the time was lost** — 2–4 bullets naming the biggest time-sinks and *why* they cost
   time, drawn from the stumbling blocks and journals. For each, say in one sentence whether it
   was a **workflow/tooling problem** (the process fought itself), a **specification gap** (the
   requirements or backend behaved differently than assumed), or an **app-level bug** — that
   distinction is what makes the report comparable across projects.

4. **The pattern & one improvement** — one short paragraph: the recurring root cause across this
   build's friction, whether the open unverified assumptions share a theme, and the **single
   highest-leverage change** — to the workflow, the spec, or the testing approach — that would
   most improve the next build.

**Style:** Markdown only — `##` sub-headings, `-` bullets, `**bold**` for the key phrase in a
bullet. No top-level `#` heading (the panel supplies its own title). No tables, no code blocks, no
links. Don't restate every number — the metric cards already show them. Interpret: say what a
number means, whether it's good, and what caused it.

## Step 4: What to lead with in the spoken summary

Active build time vs. calendar span, estimated AI cost in ZAR when available, epics/stories
delivered, the first-pass E2E yield, and the single biggest time-sink. Mention any excluded
sessions in one clause.

For a deeper cost breakdown or manual session exclusions, point the user at
`/build-report-cost`; for per-story effort by screen type, `/build-report-effort`.

## Related

- `/build-report-stakeholders` — the client-facing delivery report
- `/build-report-cost` — token/cost breakdown per phase and epic
- `/build-report-effort` — build time and cost per story, grouped by screen type
- `/status`, `/dashboard`, `/quality-check`

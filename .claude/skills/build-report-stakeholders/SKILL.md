---
name: build-report-stakeholders
description: Generate the client-facing delivery report — what shipped in product language, the decisions the user signed off, the quality evidence (automated tests plus hands-on checks), and what's still to come. No internal machinery, no cost figures. For the internal version use /build-report-maintainer.
---

You are producing the **stakeholder delivery report**: a client-facing account of what was
delivered, the choices the owner signed off, how far it has been verified, and what is still to
come. It opens in the browser like `/dashboard`.

Write for **someone who owns this application but doesn't read code and doesn't know the build
process.** The internal machinery — rework, churn, tooling friction, cost, velocity — is
deliberately **left off this page**; that's what `/build-report-maintainer` is for.

This is **display-only** — do not modify workflow state, run tests, or resume the workflow.

The report has three layers:

- **What shipped, the quality evidence, and what's next** — computed deterministically from git
  history and the workflow's own files (`state.json`, `journal.md`, tracked files under `web/`).
  You don't write these; the generator does.
- **A “What this means” insight panel** — a short plain-language account you author.
- **A “Decisions you signed off” section** — a curated list of the choices the owner was asked to
  make, which you also author (Step 2).

## This report's parameters

| | |
|---|---|
| **Audience flag** | `--audience stakeholders` (**required** — omitting it builds the maintainer page) |
| **Page** | `generated-docs/reports/build-report-stakeholders.html` |
| **Insight file** | `generated-docs/reports/build-report-insights-stakeholders.md` |
| **Insight brief** | the *Writing the insight panel* section below |
| **Sign-off file** | `generated-docs/reports/build-report-decisions.json` |
| **Exchange rate** | **Not used** — this page shows no cost, so run the cost generator without `--rate` |

No team-name question for this audience — that's a maintainer-report field.

## Step 1: Run the shared procedure through Step B

Follow **[build-report-procedure.md](../../shared/build-report-procedure.md)** Steps A and B,
using this report's parameters above.

**Take the session exclusions in Step A seriously here.** On this page an analysis conversation's
questions would surface as *product decisions the client signed off*, which they never did.

## Step 2: Curate the sign-off log

The **“Decisions you signed off”** section turns the build's own record of every question the user
was asked into a plain-language list of the choices that shaped the product. **Change the rules
below to change what appears** — what counts as a decision worth showing, how it's worded, how
much detail each line carries.

Read the decision log in `generated-docs/reports/build-cost-data.json` and write a curated version
to `generated-docs/reports/build-report-decisions.json`. Every question and answer is recorded verbatim
under `buckets[].decisions[]` (each bucket is a phase or feature area, named in `buckets[].label`),
with `header`, `question`, `answer` (`null` when never answered) and `ts` (epoch milliseconds).

Skip this step when the cost data doesn't exist (no transcripts on this machine) — the section then
disappears on its own. Never hand-write a decision that isn't in the log.

**Include a decision when the answer shaped the product** — something the owner would recognise as
their choice, and might want to revisit: how people sign in, what roles exist and what each may
do; what a screen shows or how a feature behaves; scope calls (build now, defer, leave out); data
and integration choices (which backend, which environment, live vs. sample data); policy and
compliance calls (retention, privacy, security hardening).

**Exclude the machinery.** These are real decisions, but they're about *how the work was run*, and
this report is for a reader who doesn't know the build process: git, branches, pull requests,
merges, CI; approving a plan or a story list, or choosing what to build next; running work in
parallel, restarting or re-running a step; tool setup, upgrades, file paths, report and dashboard
questions; confirming a hands-on test passed (verification is covered separately).

**Never soften one.** If a choice deferred a feature or accepted a limitation, say so plainly — a
sign-off record containing only good news is worthless. A question whose `answer` is `null` was
never decided: it is **not** a decision, so leave it out and don't count it as machinery either.

Word each entry:

- `area` — the feature area in product terms, normally the bucket label with the internal wording
  dropped (`Epic 2 — File Logs dashboard` → `File logs`), and `Project setup` for setup-phase
  decisions. **Correct it when the decision is plainly about another part of the product**: buckets
  are time windows, not feature boundaries, so a CSV-export choice recorded during the "Per-file
  summary" window belongs under `Exporting`. Reuse the same wording for every decision in an area.
- `decision` — what was being decided, as a short noun phrase, not a question: `How people sign in`,
  `Who can approve a transaction`.
- `choice` — what was chosen, in one plain sentence. Keep the substance exact; a reader must not
  come away with a different understanding than the recorded answer. Drop internal terms and any
  `(Recommended)` marker.
- `when` — the date only, `YYYY-MM-DD`, from `ts`.

No jargon anywhere: no "epic", "story", "E2E", "BFF", "MSW", "mock handler", "branch", or tool
names. If a term can't be avoided, explain it in the same sentence in plain words.

Write exactly this shape — no other keys, no commentary in the file:

```json
{
  "decisions": [
    {
      "area": "Project setup",
      "decision": "How people sign in",
      "choice": "Sign-in is handled by the server rather than in the browser, which keeps login details out of the browser.",
      "when": "2026-07-14"
    }
  ],
  "excludedCount": 16
}
```

`decisions` in the order they were made (oldest first, which groups naturally by area because the
log is already in that order). `excludedCount` is how many recorded decisions you left out **as
machinery** — the report states it, so the reader knows the list is curated rather than complete.
The generator escapes everything, so write plain text only — no markdown, no HTML.

## Step 3: Finish the shared procedure

Continue with **[build-report-procedure.md](../../shared/build-report-procedure.md)** Steps C to F.

In Step D the generator also picks up `build-report-decisions.json` and prints `signOff: included`
or `none` — if it says `none` while Step 2 wrote a file, the file's shape is wrong; re-read the
prompt's Output section and fix it.

## Writing the insight panel

This is the brief the shared procedure's Step C refers to. **Change the wording below to change
what the panel says** — shift the emphasis (scope vs. quality vs. timeline), change the tone, or add
a question your stakeholders always ask.

> **`/upgrade` replaces this file**, so edits here last until the next template update, not beyond.
> If you want wording that survives, keep a copy of your version somewhere in the project and
> re-apply it after upgrading. The same applies to the sign-off brief in Step 2.

Read `generated-docs/reports/build-report-data.json` (the computed metrics) and each epic's `journal.md`,
then write the summary to `generated-docs/reports/build-report-insights-stakeholders.md` — that file only,
nothing else in it.

Write for **a client or sponsor who owns this application but doesn't read code and doesn't know
the build process**. No jargon at all — no "epics", "stories", "E2E", "commits" or tool names; say
"feature areas", "capabilities", "automated browser tests". Be honest and concrete; never oversell.
Base every claim on the data; never invent numbers or events. Internal build friction (tooling
problems, rework) stays out of this panel unless it changed what was delivered.

Aim for **3 short sections**, roughly 200–300 words total:

1. **What you're getting** — one short paragraph: the capabilities now working, described in
   product terms (what a user can now do), how much of the planned scope that covers, and the
   effort it took (calendar span and active build time — note the active figure is a conservative
   floor).

2. **How much you can trust it** — 2–3 bullets on the quality evidence: the automated tests that
   run before every release (and what kind of thing they catch), the hands-on human verification
   against the real system and its result, and — honestly — anything that could **not** be verified
   yet and why, including what the flagged open assumptions mean in practice.

3. **What happens next** — one short paragraph: the planned capability not yet built, any items
   deferred until it lands, and anything the stakeholder themselves should look at or decide.

**Style:** Markdown only — `##` sub-headings, `-` bullets, `**bold**` for the key phrase in a
bullet. No top-level `#` heading (the panel supplies its own title). No tables, no code blocks, no
links. Short sentences. Every number gets its plain-language meaning in the same sentence.

## Step 4: What to lead with in the spoken summary

Delivery and verification, not effort: the capabilities delivered, how much of the planned scope
that covers, the checks that passed, how many decisions the sign-off section lists (and how many
were left out as machinery), and what's still to come. Mention any excluded sessions in one clause.

Also mention that the written panel and the sign-off list are shaped by the two briefs in this
skill, so their wording and what counts as a decision can both be changed there.

## Related

- `/build-report-maintainer` — the internal report (effort, cost, workflow performance)
- `/status`, `/dashboard`, `/quality-check`

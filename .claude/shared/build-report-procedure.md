# Build-report procedure (shared)

The steps common to **`/build-report-maintainer`** and **`/build-report-stakeholders`**. Both
reports come from the same collector and generator; only the audience, the editable insight
prompt, and one extra authored section differ. Those differences live in each skill's own
`SKILL.md` — everything here is identical for both, and lives in one place so the two can't
drift apart.

Each skill tells you its **audience**, its **insight brief** (a section in that skill) and its
**insight output file**. Substitute those below wherever you see `<audience>`, `<insight brief>`,
`<insight file>`.

Both reports are **display-only**: never modify workflow state, run tests, or resume the
workflow.

---

## A. Refresh the cost & decision data

Both audiences read `/build-report-cost`'s data file — the maintainer report for its cost and
involvement panel, the stakeholders report for the decision log behind its sign-off section.
Refresh it **best-effort, never blocking**:

```bash
node .claude/skills/build-report-cost/generate-build-cost-report.mjs [--rate=<ZAR_RATE>] [--exclude=<ids>]
```

- **`--rate` is maintainer-only.** The stakeholders page shows no cost, so run it without a
  rate there (the placeholder warning is harmless).
- **Exclude sessions that aren't part of the build.** The script auto-flags sessions whose
  first command is a report command, but an analysis conversation that began with free text is
  **not** caught — and on a client-facing page its questions would surface as product
  decisions. List the transcripts with `ls ~/.claude/projects/<project-slug>/*.jsonl`, then
  identify any you don't recognise by reading the opening messages of each — use `Grep` on the
  `.jsonl` for `"type":"text","text":"` (per CLAUDE.md §10, not `grep` via Bash). Pass the
  unrelated ones with `--exclude=<id1>,<id2>`.

  Note whatever it reports as `postDeliverySessionsExcluded` — mention it in Step F.
- **If the script fails** (no transcripts on this machine, no epics yet), **continue anyway.**
  The report still renders and says the cost data is missing; on the stakeholders page the
  sign-off section simply disappears.

## B. Generate the metrics and collect the data

```bash
node .claude/scripts/generate-build-report-html.js --collect --audience <audience>
```

Read the JSON it prints:

- `status: "no_project"` → no project yet; suggest `/start`. **Stop.**
- `status: "legacy_detected"` → suggest `/migrate-legacy`. **Stop.**
- The script itself fails → report the actual error and suggest checking `.claude/scripts/`. **Stop.**
- `status: "ok"` → the metrics HTML and `generated-docs/reports/build-report-data.json` are written. Continue.

## C. Write the insight panel

Read **`<insight brief>`** in the calling skill and follow it exactly. Treat
its current wording as the instruction — don't substitute your own structure or headings. It
tells you what to read and to write the result to **`<insight file>`**.

Ground every statement in the data. **Never invent a number or an event.** If a figure in the
data is a floor or an artifact (an active-time estimate, a cost total missing its sub-agent
share, a calendar span inflated by later maintenance), say so in the same sentence rather than
presenting it as exact — a report that quietly overstates is worse than one that qualifies.

Check the existing insight file before overwriting it: if it was authored against older data,
its numbers will contradict the freshly computed metrics on the same page.

## D. Regenerate so the authored panel is included

```bash
node .claude/scripts/generate-build-report-html.js --collect --audience <audience>
```

The generator picks up the audience's insight file automatically and renders it as the top
panel. It prints `insights: included` — if it still says `none`, the file wasn't written where
the prompt said. (For metrics only, run with `--no-insights` and skip Step C.)

## E. Open it

```bash
start "" "<the html path the generator printed>"
```

## F. Confirm

Tell the user the report is open and give a **two-line** spoken summary — each skill says what
to lead with. Mention in one clause if Step A excluded any sessions. Then remind them they can
reshape the written panel any time by editing **`<insight brief>`** in the skill and re-running the command.

---

## DO

- Report errors to the user — this is synchronous, they triggered it explicitly.
- Base the insight panel only on the computed data and the journals/feedback.
- Open the browser after the second generation pass.

## DON'T

- Modify workflow state, run tests, or resume the workflow — display-only.
- Invent metrics, durations, or events not present in the data.
- Rewrite the insight brief's structure — follow it as the skill has it.
- Show raw JSON to the user.

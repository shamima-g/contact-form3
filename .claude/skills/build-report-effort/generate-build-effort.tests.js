#!/usr/bin/env node
/**
 * Tests for generate-build-effort.mjs — the /build-report-effort generator.
 *
 * These drive the REAL script end to end as a child process, using the
 * `--project-root` / `--transcripts` flags it already accepts, and assert on the
 * `build-effort-data.json` it writes. No production refactor, and the path under test
 * is the one users run — including the HTML write and the exit codes.
 *
 * What's pinned here is what the report claims about itself: title-based screen-type
 * classification (never the epic slug), ground-truth story windows, marginal vs
 * overhead split, and the coverage gate that degrades to time-only rather than
 * publishing wrong dollar figures.
 *
 * Usage:
 *   node .claude/skills/build-report-effort/generate-build-effort.tests.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, assertEqual, assertDeepEqual, summary } = require('../../scripts/lib/test-harness');

const SCRIPT = path.join(__dirname, 'generate-build-effort.mjs');
const tmp = (name, fn) => test(name, fn, { tmpDir: 'build-effort-' });

const close = (actual, expected, msg, eps = 1e-9) => {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg}: expected ~${expected}, got ${actual}`);
};

// ---- fixture project ----------------------------------------------------------
// epics[slug] = { name, stories: { "<N>": { startedAt, completedAt, title } } }
// `title` becomes the Playwright spec filename, which is where the generator reads
// story titles from — so it drives classification exactly as it does in a real project.
function writeProject(root, epics) {
  for (const [slug, epic] of Object.entries(epics)) {
    const dir = path.join(root, 'generated-docs', 'epics', slug);
    fs.mkdirSync(dir, { recursive: true });
    const stories = {};
    for (const [n, s] of Object.entries(epic.stories)) {
      stories[n] = { status: 'complete', commit: null, e2eStatus: 'passed', startedAt: s.startedAt, completedAt: s.completedAt };
      if (s.title) {
        const e2e = path.join(root, 'web', 'e2e');
        fs.mkdirSync(e2e, { recursive: true });
        fs.writeFileSync(path.join(e2e, `epic-${slug}-story-${n}-${s.title}.spec.ts`), '');
      }
    }
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ epic: { name: epic.name || slug, createdAt: '2026-07-01T08:00:00Z' }, stories }, null, 2));
  }
  return root;
}

// Sonnet 4.6 is the fixture default deliberately: same list price as Sonnet 5 but no
// promotional window, so LINE_COST below stays a fixed number. Pricing is date-aware (a
// promo rate applies only to spend inside its window), so a fixture on a promo'd model
// would silently change cost whenever the fixture timestamps crossed the promo end date.
const usageLine = ({ id, ts, input = 1000, output = 100, model = 'claude-sonnet-4-6' }) =>
  JSON.stringify({
    type: 'assistant', timestamp: ts, uuid: `uuid-${id}`,
    message: { id, model, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }) + '\n';

// Cost of one usageLine at the defaults: Sonnet 4.6 input $3 / output $15 per 1M.
const LINE_COST = (1000 * 3 + 100 * 15) / 1e6; // 0.0045
const LINE_TOKENS = 1100;

// `sessions[sid] = { main: [line], subagents: { name: [line] } }` under a snapshot dir the
// generator is pointed at with --transcripts.
function writeTranscripts(root, sessions) {
  const store = path.join(root, 'transcript-store');
  const dir = path.join(store, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  for (const [sid, s] of Object.entries(sessions)) {
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), (s.main || []).join(''));
    if (!s.subagents) continue;
    const subDir = path.join(dir, sid, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    for (const [name, lines] of Object.entries(s.subagents)) {
      fs.writeFileSync(path.join(subDir, `${name}.jsonl`), lines.join(''));
      fs.writeFileSync(path.join(subDir, `${name}.meta.json`), JSON.stringify({ agentType: name }));
    }
  }
  return store;
}

// Runs the generator; returns { status, stdout, stderr, data, html }.
// spawnSync rather than execFileSync: the warnings this suite asserts on go to stderr on a
// SUCCESSFUL run, and execFileSync only hands back stdout unless the process fails.
function run(root, extraArgs = []) {
  const args = [SCRIPT, `--project-root=${root}`, ...extraArgs];
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (res.error) throw res.error;
  const status = res.status, stdout = res.stdout || '', stderr = res.stderr || '';
  const dataFile = path.join(root, 'generated-docs', 'reports', 'build-effort-data.json');
  const htmlFile = path.join(root, 'generated-docs', 'reports', 'build-effort.html');
  return {
    status, stdout, stderr,
    data: fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : null,
    html: fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile, 'utf8') : null,
  };
}

const story = (n, title, startMin, endMin, day = '2026-07-01') => ({
  [n]: {
    title,
    startedAt: `${day}T${String(9 + Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}:00Z`,
    completedAt: `${day}T${String(9 + Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00Z`,
  },
});

// =============================================================================
// HAPPY PATH — time, cost, marginal vs overhead
// =============================================================================

console.log('\nMeasured build effort:');

tmp('per-story time and cost come from the story windows, with everything outside them as overhead', (root) => {
  writeProject(root, {
    billing: { name: 'Billing', stories: { ...story(1, 'invoice-table', 0, 30), ...story(2, 'approve-invoice', 60, 70) } },
  });
  const store = writeTranscripts(root, {
    s1: {
      main: [usageLine({ id: 'between', ts: '2026-07-01T11:00:00Z' })], // outside both windows → overhead
      subagents: {
        developer: [usageLine({ id: 'in1', ts: '2026-07-01T09:05:00Z' })],      // inside story 1
        'test-generator': [usageLine({ id: 'in2', ts: '2026-07-01T10:05:00Z' })], // inside story 2
      },
    },
  });
  const { status, data } = run(root, [`--transcripts=${store}`]);
  assertEqual(status, 0, 'exit code');
  assertEqual(data.costComplete, true, 'sub-agent logs present and every story has cost → complete');
  assertEqual(data.totals.stories, 2, 'two stories measured');
  assertEqual(data.totals.medMinutes, 20, 'median of a 30-min and a 10-min story');
  assertEqual(data.totals.buildMinutes, 40, 'summed build minutes');
  close(data.totals.inStoryCost, LINE_COST * 2, 'in-story cost');
  close(data.totals.overheadCost, LINE_COST, 'overhead cost');
  close(data.totals.totalCost, LINE_COST * 3, 'total cost');
  close(data.totals.overheadShare, 1 / 3, 'overhead share');
  close(data.totals.fullyLoadedPerStory, (LINE_COST * 3) / 2, 'fully-loaded per story amortises overhead');
  const s1 = data.stories.find((s) => s.n === '1');
  close(s1.cost, LINE_COST, 'story 1 cost');
  assertEqual(s1.tokens, LINE_TOKENS, 'story 1 tokens');
  assertEqual(s1.min, 30, 'story 1 minutes');
});

tmp('the report page is written and names each story', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const { html } = run(root);
  assert(html && html.includes('<!doctype html>'), 'self-contained page written');
  assert(html.includes('invoice table'), 'story title rendered');
  assert(html.includes('Listing / table page'), 'screen type rendered');
});

tmp('a story window with no transcript records still reports its time', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 45) } });
  const { status, data } = run(root);
  assertEqual(status, 0, 'exit code');
  assertEqual(data.totals.medMinutes, 45, 'time is reported without any cost data');
  assertEqual(data.stories[0].cost, 0, 'no cost attributed');
});

// =============================================================================
// COVERAGE GATE — degrade to time-only rather than publish wrong money
// =============================================================================

console.log('\nCost completeness gate:');

tmp('cost below 60% story coverage degrades the whole report to time-only', (root) => {
  writeProject(root, {
    billing: {
      stories: {
        ...story(1, 'invoice-table', 0, 30),
        ...story(2, 'approve-invoice', 60, 90),
        ...story(3, 'invoice-detail', 120, 150),
        ...story(4, 'export-invoices', 180, 210),
      },
    },
  });
  const store = writeTranscripts(root, {
    s1: { main: [], subagents: { developer: [usageLine({ id: 'in1', ts: '2026-07-01T09:05:00Z' })] } }, // 1 of 4 stories
  });
  const { data, html, stderr } = run(root, [`--transcripts=${store}`]);
  assertEqual(data.costComplete, false, '25% coverage is below the 60% threshold');
  assert(html.includes('Token cost unavailable'), 'page says cost is unavailable');
  assert(!html.includes('Fully-loaded / story'), 'no cost tiles rendered');
  assert(/INCOMPLETE/.test(stderr), 'the run warns on stderr');
});

tmp('orchestrator-only logs (no sub-agent transcripts) are treated as incomplete cost', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const store = writeTranscripts(root, { s1: { main: [usageLine({ id: 'in1', ts: '2026-07-01T09:05:00Z' })] } });
  const { data } = run(root, [`--transcripts=${store}`]);
  assertEqual(data.costComplete, false, 'no sub-agent logs → cost cannot be reconstructed');
  close(data.totals.totalCost, LINE_COST, 'the total is still computed for the record');
});

tmp('--exclude drops a session and its sub-agents from the totals', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const store = writeTranscripts(root, {
    keep: { main: [], subagents: { developer: [usageLine({ id: 'k', ts: '2026-07-01T09:05:00Z' })] } },
    'report-session': { main: [], subagents: { developer: [usageLine({ id: 'd', ts: '2026-07-01T09:06:00Z' })] } },
  });
  const { data } = run(root, [`--transcripts=${store}`, '--exclude=report-session']);
  close(data.totals.totalCost, LINE_COST, 'only the kept session counts');
});

// =============================================================================
// CLASSIFICATION — title-based, first match wins, never the epic slug
// =============================================================================

console.log('\nScreen-type classification:');

tmp('each screen type is recognised from the story title', (root) => {
  writeProject(root, {
    app: {
      stories: {
        ...story(1, 'invoice-table', 0, 10),
        ...story(2, 'approve-invoice', 20, 30),
        ...story(3, 'upload-statement', 40, 50),
        ...story(4, 'invoice-detail', 60, 70),
        ...story(5, 'export-invoices', 80, 90),
        ...story(6, 'sign-in', 100, 110),
        ...story(7, 'zzz-unclassifiable', 120, 130),
      },
    },
  });
  const { data } = run(root);
  const cat = Object.fromEntries(data.stories.map((s) => [s.title, s.cat]));
  assertEqual(cat['invoice table'], 'Listing / table page', 'listing');
  assertEqual(cat['approve invoice'], 'Record action', 'record action');
  assertEqual(cat['upload statement'], 'Upload / create form', 'upload');
  assertEqual(cat['invoice detail'], 'Detail / summary view', 'detail');
  assertEqual(cat['export invoices'], 'Export', 'export');
  assertEqual(cat['sign in'], 'Auth / app-shell / infra', 'auth');
  assertEqual(cat['zzz unclassifiable'], 'Other', 'unmatched titles fall through to Other');
});

tmp('the epic slug never leaks into classification', (root) => {
  // The documented trap: an epic named "…-export" must not tag its listing stories as Export.
  writeProject(root, { 'data-export': { stories: { ...story(1, 'invoice-table', 0, 10), ...story(2, 'sign-in', 20, 30) } } });
  const { data } = run(root);
  const cat = Object.fromEntries(data.stories.map((s) => [s.title, s.cat]));
  assertEqual(cat['invoice table'], 'Listing / table page', 'listing story in an export epic stays a listing');
  assertEqual(cat['sign in'], 'Auth / app-shell / infra', 'auth story in an export epic stays auth');
});

tmp('earlier taxonomy rules win over later ones', (root) => {
  // "create export" matches both Export and Record action; Export is declared first.
  // "upload invoice" matches both Upload and Record action; Upload is declared first.
  writeProject(root, { app: { stories: { ...story(1, 'create-export', 0, 10), ...story(2, 'upload-invoice', 20, 30) } } });
  const { data } = run(root);
  const cat = Object.fromEntries(data.stories.map((s) => [s.title, s.cat]));
  assertEqual(cat['create export'], 'Export', 'Export outranks Record action');
  assertEqual(cat['upload invoice'], 'Upload / create form', 'Upload outranks Record action');
});

tmp('a story with no Playwright spec is still measured, under a fallback title', (root) => {
  writeProject(root, { billing: { stories: { 1: { startedAt: '2026-07-01T09:00:00Z', completedAt: '2026-07-01T09:30:00Z' } } } });
  const { data } = run(root);
  assertEqual(data.stories[0].title, 'story 1', 'fallback title');
  assertEqual(data.stories[0].cat, 'Other', 'unclassifiable without a title');
});

tmp('categories are aggregated with medians and counts, in the report\'s fixed order', (root) => {
  writeProject(root, {
    app: {
      stories: {
        ...story(1, 'invoice-table', 0, 10),   // Listing, 10 min
        ...story(2, 'orders-table', 20, 50),   // Listing, 30 min
        ...story(3, 'approve-order', 60, 80),  // Record action, 20 min
      },
    },
  });
  const { data } = run(root);
  assertDeepEqual(data.categories.map((c) => c.cat), ['Listing / table page', 'Record action'], 'declared order, empty categories omitted');
  const listing = data.categories[0];
  assertEqual(listing.n, 2, 'two listing stories');
  assertEqual(listing.medMin, 20, 'median of 10 and 30');
  assertEqual(listing.meanMin, 20, 'mean of 10 and 30');
});

// =============================================================================
// GROUND-TRUTH GUARDS — malformed or missing inputs
// =============================================================================

console.log('\nMalformed and missing inputs:');

tmp('stories with a missing, unparseable or inverted window are skipped', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const stateFile = path.join(root, 'generated-docs', 'epics', 'billing', 'state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.stories['2'] = { status: 'complete', startedAt: null, completedAt: '2026-07-01T10:00:00Z' };           // never started
  state.stories['3'] = { status: 'complete', startedAt: '2026-07-01T10:00:00Z', completedAt: null };            // never finished
  state.stories['4'] = { status: 'complete', startedAt: 'not-a-date', completedAt: '2026-07-01T10:00:00Z' };    // junk
  state.stories['5'] = { status: 'complete', startedAt: '2026-07-01T11:00:00Z', completedAt: '2026-07-01T10:00:00Z' }; // inverted
  state.stories['6'] = { status: 'complete', startedAt: '2026-07-01T10:00:00Z', completedAt: '2026-07-01T10:00:00Z' }; // zero-length
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const { status, data } = run(root);
  assertEqual(status, 0, 'exit code');
  assertEqual(data.totals.stories, 1, 'only the one valid window is measured');
});

tmp('a malformed state.json is skipped, not fatal, when another epic is readable', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const broken = path.join(root, 'generated-docs', 'epics', 'broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'state.json'), '{not json');
  const { status, data } = run(root);
  assertEqual(status, 0, 'exit code');
  assertEqual(data.totals.stories, 1, 'the readable epic is still reported');
});

tmp('no epics directory exits non-zero with a plain-language reason', (root) => {
  fs.mkdirSync(path.join(root, 'generated-docs'), { recursive: true });
  const { status, stderr, data } = run(root);
  assertEqual(status, 1, 'exit code');
  assert(/No epics/i.test(stderr), 'says there are no epics');
  assertEqual(data, null, 'nothing written');
});

tmp('epics with no timestamped stories exit non-zero rather than reporting an empty build', (root) => {
  writeProject(root, { billing: { stories: { 1: { startedAt: null, completedAt: null } } } });
  const { status, stderr } = run(root);
  assertEqual(status, 1, 'exit code');
  assert(/timestamps/i.test(stderr), 'says the timestamps are missing');
});

tmp('an unknown model is priced as Opus 4.8 and reported, never silently', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const store = writeTranscripts(root, {
    s1: { main: [], subagents: { developer: [usageLine({ id: 'm1', ts: '2026-07-01T09:05:00Z', model: 'claude-unreleased-9' })] } },
  });
  const { data, stderr } = run(root, [`--transcripts=${store}`]);
  assertDeepEqual(data.unknownModels, ['claude-unreleased-9'], 'recorded in the data file');
  assert(/unknown models/i.test(stderr), 'and warned on stderr');
  close(data.totals.totalCost, (1000 * 5 + 100 * 25) / 1e6, 'priced at the Opus 4.8 fallback rate');
});

tmp('--rate adds ZAR alongside USD without changing the USD figures', (root) => {
  writeProject(root, { billing: { stories: story(1, 'invoice-table', 0, 30) } });
  const store = writeTranscripts(root, {
    s1: { main: [], subagents: { developer: [usageLine({ id: 'm1', ts: '2026-07-01T09:05:00Z' })] } },
  });
  const { data, html } = run(root, [`--transcripts=${store}`, '--rate=18.5']);
  assertEqual(data.rate, 18.5, 'rate recorded');
  close(data.totals.totalCost, LINE_COST, 'USD unchanged');
  assert(html.includes('R'), 'ZAR rendered on the page');
});

// =============================================================================
// OVERLAPPING STORY WINDOWS — the split, and what it does to per-feature figures
// =============================================================================
// Epics can be built in parallel, so a message's timestamp can sit inside several story
// windows at once. The generator splits its cost evenly across every story in flight. These
// cases are the guard on that: reverting to `.find()` (first match wins) would pile all the
// concurrent spend onto whichever story started earliest and drain one feature into another.

// alpha 09:00–09:30, beta 09:15–09:45 → 09:15–09:30 is ambiguous.
// Four records: one alpha-only, one in the overlap, one beta-only, one outside both.
const overlapFixture = (root) => {
  writeProject(root, {
    alpha: { name: 'Alpha', stories: story(1, 'invoice-table', 0, 30) },
    beta: { name: 'Beta', stories: story(1, 'approve-invoice', 15, 45) },
  });
  return writeTranscripts(root, {
    s1: {
      main: [],
      subagents: {
        developer: [
          usageLine({ id: 'm1', ts: '2026-07-01T09:05:00Z' }), // alpha only
          usageLine({ id: 'm2', ts: '2026-07-01T09:20:00Z' }), // BOTH — split
          usageLine({ id: 'm3', ts: '2026-07-01T09:40:00Z' }), // beta only
          usageLine({ id: 'm4', ts: '2026-07-01T10:00:00Z' }), // neither — overhead
        ],
      },
    },
  });
};

tmp('a message inside two story windows is split evenly, not given to the first match', (root) => {
  const store = overlapFixture(root);
  const { data } = run(root, [`--transcripts=${store}`]);
  const [alpha, beta] = data.epics;
  assertEqual(alpha.slug, 'alpha', 'epics ordered by start');
  // First-match-wins would make this 2×LINE_COST for alpha and 1× for beta.
  close(alpha.marginalCost, 1.5 * LINE_COST, 'alpha keeps its own record plus half the shared one');
  close(beta.marginalCost, 1.5 * LINE_COST, 'beta likewise');
  close(data.totals.inStoryCost, 3 * LINE_COST, 'splitting conserves the in-story total');
  close(data.totals.totalCost, 4 * LINE_COST, 'and the project total');
  close(data.totals.overheadCost, LINE_COST, 'the record outside both windows is overhead');
});

tmp('the ambiguous share and the parallel features are both reported', (root) => {
  const store = overlapFixture(root);
  const { data, stderr, html } = run(root, [`--transcripts=${store}`]);
  close(data.attribution.ambiguousCost, LINE_COST, 'the shared record is counted once, in full');
  close(data.attribution.ambiguousShare, 1 / 3, 'as a share of in-story spend');
  assertDeepEqual(data.attribution.parallelEpics, ['alpha', 'beta'], 'both features flagged');
  assert(data.epics.every((e) => e.parallel), 'and marked on the rows');
  assert(/2 of 2 features were built in parallel \(alpha, beta\)/.test(html), 'banner names them');
  assert(/features built in parallel: alpha, beta/.test(stderr), 'and stderr does too');
});

tmp('overlap inside ONE feature never claims features were built in parallel', (root) => {
  // Two windows of the same epic overlapping (a re-opened story) is still ambiguous spend, but
  // no feature total is affected — so the report must not print an empty parallel-features list.
  writeProject(root, {
    alpha: {
      name: 'Alpha',
      stories: { ...story(1, 'invoice-table', 0, 30), ...story(2, 'approve-invoice', 15, 45) },
    },
  });
  const store = writeTranscripts(root, {
    s1: {
      main: [],
      subagents: {
        developer: [
          usageLine({ id: 'm1', ts: '2026-07-01T09:05:00Z' }),
          usageLine({ id: 'm2', ts: '2026-07-01T09:20:00Z' }), // in both windows
          usageLine({ id: 'm3', ts: '2026-07-01T09:40:00Z' }),
        ],
      },
    },
  });
  const { data, stderr, html } = run(root, [`--transcripts=${store}`]);
  assert(data.attribution.ambiguousShare > 0.05, 'the overlap is still reported');
  assertDeepEqual(data.attribution.parallelEpics, [], 'no cross-feature overlap to name');
  assert(!/0 of 1 features/.test(html), 'never "0 of N features were built in parallel"');
  assert(!/parallel \(\)/.test(html) && !/parallel: \)/.test(stderr), 'and never an empty list');
  assert(/inside a single feature/.test(html), 'the page names the real cause');
  assert(/within a single feature/.test(stderr), 'and so does stderr');
});

// =============================================================================
// FEATURE (EPIC) ROLL-UP — the level a new feature gets estimated at
// =============================================================================
tmp('an epic sums its stories; elapsed spans first start to last end', (root) => {
  writeProject(root, {
    alpha: { name: 'Alpha', stories: { ...story(1, 'invoice-table', 0, 20), ...story(2, 'export-csv', 30, 50) } },
  });
  const store = writeTranscripts(root, {
    s1: { main: [], subagents: { developer: [usageLine({ id: 'm1', ts: '2026-07-01T09:10:00Z' }), usageLine({ id: 'm2', ts: '2026-07-01T09:35:00Z' })] } },
  });
  const { data } = run(root, [`--transcripts=${store}`]);
  const [alpha] = data.epics;
  assertEqual(alpha.stories, 2, 'story count');
  close(alpha.buildMinutes, 40, 'build time sums the two measured windows');
  close(alpha.elapsedMinutes, 50, 'elapsed includes the 10-minute gap between them');
  close(data.benchmarks.timeUplift, 50 / 40, 'timeUplift is elapsed over summed story minutes');
  assertEqual(alpha.parallel, false, 'a lone feature is never flagged parallel');
  // catOrder, not the order the stories were built: Listing precedes Export.
  assertDeepEqual(alpha.mix.map((m) => m.short), ['listing', 'export'], 'screen mix in the report’s fixed order');
});

tmp('fully-loaded per-feature costs are the overhead allocated pro-rata, and sum to the total', (root) => {
  const store = overlapFixture(root);
  const { data } = run(root, [`--transcripts=${store}`]);
  const b = data.benchmarks;
  close(b.costUplift, 4 / 3, 'costUplift is total spend over in-story spend');
  for (const e of data.epics) close(e.loadedCost, e.marginalCost * b.costUplift, `${e.slug} loaded = marginal × uplift`);
  // The invariant the feature table's footer depends on: the loaded column must total the project
  // spend, or the page shows a "fully loaded" sum that disagrees with its own total.
  close(data.epics.reduce((s, e) => s + e.loadedCost, 0), data.totals.totalCost, 'loaded costs sum to total spend');
});

tmp('the typical-feature story count is a whole number even with an even number of features', (root) => {
  // Two epics, 1 and 2 stories → raw median 1.5. "1.5 stories" is not a benchmark.
  writeProject(root, {
    alpha: { name: 'Alpha', stories: story(1, 'invoice-table', 0, 20) },
    beta: { name: 'Beta', stories: { ...story(1, 'approve-invoice', 30, 50), ...story(2, 'export-csv', 60, 80) } },
  });
  const store = writeTranscripts(root, {
    s1: { main: [], subagents: { developer: [usageLine({ id: 'm1', ts: '2026-07-01T09:10:00Z' }), usageLine({ id: 'm2', ts: '2026-07-01T09:40:00Z' }), usageLine({ id: 'm3', ts: '2026-07-01T10:10:00Z' })] } },
  });
  const { data, html, stdout } = run(root, [`--transcripts=${store}`]);
  assertEqual(data.totals.epics, 2, 'two features');
  assertEqual(data.benchmarks.typicalEpic.stories, 2, 'median of 1 and 2 rounded, not 1.5');
  assert(!/1\.5\s*<small>stories/.test(html), 'no fractional story count on the page');
  assert(!/1\.5 stories/.test(stdout), 'nor in the console summary');
});

summary();

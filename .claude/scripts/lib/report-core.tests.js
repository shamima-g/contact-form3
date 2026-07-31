#!/usr/bin/env node
/**
 * Tests for lib/report-core.mjs — the ONE pricing table, cache multipliers,
 * transcript-directory discovery and deduped usage reader shared by
 * /build-report-cost and /build-report-effort.
 *
 * Why these tests exist: both reports state "ground truth only" and publish ZAR/USD
 * figures from this module. A silent regression here (a wrong cache multiplier, a lost
 * dedup, a skipped sub-agent dir) mis-states cost in both reports with no visible
 * failure, so the arithmetic and the reader are pinned here.
 *
 * report-core is ESM and this file is CJS, so it loads via dynamic import(). The harness
 * is deliberately synchronous — the single await happens in the bootstrap below, and every
 * test() callback stays sync.
 *
 * Usage:
 *   node .claude/scripts/lib/report-core.tests.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, assert, assertEqual, assertDeepEqual, summary } = require('./test-harness');

const tmp = (name, fn) => test(name, fn, { tmpDir: 'report-core-' });

// Float-safe compare: the cost formula divides by 1e6, so exact === on money is brittle.
const close = (actual, expected, msg, eps = 1e-12) => {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual}`);
  }
};

// One assistant usage line as the transcripts record it.
const line = (o) => JSON.stringify(o) + '\n';
const usageLine = ({ id, ts = '2026-07-01T09:00:00Z', model = 'claude-sonnet-5', input = 0, output = 0, cacheRead = 0, w5m = 0, w1h = 0, oneHourShape = false }) => {
  const usage = { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead };
  if (oneHourShape) usage.cache_creation = { ephemeral_5m_input_tokens: w5m, ephemeral_1h_input_tokens: w1h };
  else usage.cache_creation_input_tokens = w5m;
  return line({ type: 'assistant', timestamp: ts, uuid: `uuid-${id}`, message: { id, model, usage } });
};

// Writes <root>/<session>.jsonl and, when subagents are given, <root>/<session>/subagents/<name>.jsonl
// (+ .meta.json when an agentType is supplied) — the layout gatherUsageRecords walks.
function transcriptDir(root, sessions) {
  fs.mkdirSync(root, { recursive: true });
  for (const [sid, s] of Object.entries(sessions)) {
    fs.writeFileSync(path.join(root, `${sid}.jsonl`), (s.main || []).join(''));
    if (!s.subagents) continue;
    const subDir = path.join(root, sid, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    for (const [name, sub] of Object.entries(s.subagents)) {
      fs.writeFileSync(path.join(subDir, `${name}.jsonl`), (sub.lines || []).join(''));
      if (sub.meta !== undefined) fs.writeFileSync(path.join(subDir, `${name}.meta.json`), sub.meta);
    }
  }
  return root;
}

main().catch((err) => { console.error(err); process.exit(1); });

async function main() {
  const { PRICING, CACHE_READ_MULT, CACHE_WRITE_5M_MULT, CACHE_WRITE_1H_MULT, rates, unknownModels, discoverTranscriptDirs, gatherUsageRecords } = await import('./report-core.mjs');

  // ===========================================================================
  // PRICING + RATES
  // ===========================================================================

  console.log('\nPricing and cache multipliers:');

  test('rates(): a known model returns its list prices', () => {
    const r = rates('claude-sonnet-5');
    assertEqual(r.in, 3, 'input $/1M');
    assertEqual(r.out, 15, 'output $/1M');
  });

  test('rates(): cache rates derive from input at 0.1x read, 1.25x 5m write, 2x 1h write', () => {
    // The multipliers ARE the pricing contract — a drift here silently re-prices every report.
    assertEqual(CACHE_READ_MULT, 0.1, 'read multiplier');
    assertEqual(CACHE_WRITE_5M_MULT, 1.25, '5m write multiplier');
    assertEqual(CACHE_WRITE_1H_MULT, 2, '1h write multiplier');
    const r = rates('claude-opus-4-8'); // input $5/1M
    close(r.read, 0.5, 'cache read rate');
    close(r.w5m, 6.25, '5m cache write rate');
    close(r.w1h, 10, '1h cache write rate');
  });

  test('rates(): an unknown model falls back to Opus 4.8 and is recorded for the warning', () => {
    const before = unknownModels.size;
    const r = rates('claude-something-unreleased');
    assertEqual(r.in, PRICING['claude-opus-4-8'].input, 'falls back to the Opus 4.8 input price');
    assertEqual(r.out, PRICING['claude-opus-4-8'].output, 'falls back to the Opus 4.8 output price');
    assert(unknownModels.has('claude-something-unreleased'), 'unknown model recorded');
    assertEqual(unknownModels.size, before + 1, 'exactly one new unknown model');
    unknownModels.delete('claude-something-unreleased'); // module state is shared across tests
  });

  test('PRICING: every entry has input, output and a display name', () => {
    for (const [id, p] of Object.entries(PRICING)) {
      assert(typeof p.input === 'number' && p.input > 0, `${id} has an input price`);
      assert(typeof p.output === 'number' && p.output > 0, `${id} has an output price`);
      assert(typeof p.name === 'string' && p.name.length > 0, `${id} has a display name`);
    }
  });

  // Promotional pricing: these reports cost HISTORICAL spend, so a rate that only applied for a
  // window must be applied only to spend inside it — and never to a caller that didn't say when.
  test('rates(): promotional pricing applies to spend inside the window', () => {
    const promoed = Object.entries(PRICING).find(([, p]) => p.promo);
    if (!promoed) return; // no live promo in the table — nothing to pin
    const [id, p] = promoed;
    const inside = Date.parse(p.promo.until) - 1;
    const r = rates(id, inside);
    assertEqual(r.in, p.promo.input, `${id} uses the promo input price inside the window`);
    assertEqual(r.out, p.promo.output, `${id} uses the promo output price inside the window`);
    close(r.read, p.promo.input * CACHE_READ_MULT, 'cache read derives from the promo input price');
  });

  test('rates(): spend after the window ends is priced at list', () => {
    const promoed = Object.entries(PRICING).find(([, p]) => p.promo);
    if (!promoed) return;
    const [id, p] = promoed;
    const r = rates(id, Date.parse(p.promo.until)); // `until` is exclusive
    assertEqual(r.in, p.input, `${id} is back to the list input price`);
    assertEqual(r.out, p.output, `${id} is back to the list output price`);
  });

  test('rates(): omitting the timestamp yields list price, never promotional', () => {
    // A caller that doesn't know when the tokens were spent must not be handed a discount.
    const promoed = Object.entries(PRICING).find(([, p]) => p.promo);
    if (!promoed) return;
    const [id, p] = promoed;
    const r = rates(id);
    assertEqual(r.in, p.input, `${id} defaults to the list input price`);
    assertEqual(r.out, p.output, `${id} defaults to the list output price`);
  });

  test('rates(): estimated is false for a known model and true for a fallback-priced one', () => {
    assertEqual(rates('claude-opus-4-8').estimated, false, 'known model is not an estimate');
    const r = rates('claude-not-a-real-model');
    assertEqual(r.estimated, true, 'fallback-priced model is flagged as an estimate');
    unknownModels.delete('claude-not-a-real-model'); // module state is shared across tests
  });

  // ===========================================================================
  // TRANSCRIPT DIRECTORY DISCOVERY
  // ===========================================================================

  console.log('\nTranscript directory discovery:');

  tmp('discoverTranscriptDirs(): finds the slug dir and its git-worktree siblings, not unrelated dirs', (root) => {
    const projectRoot = '/c/work/my-app';
    const slug = projectRoot.replace(/[^a-zA-Z0-9]/g, '-');
    const store = path.join(root, 'projects');
    for (const d of [slug, `${slug}--wt-epic-a`, `${slug}--wt-epic-b`, 'some-other-project', `${slug}-notasibling`]) {
      fs.mkdirSync(path.join(store, d), { recursive: true });
    }
    const { dirs, slug: got } = discoverTranscriptDirs(projectRoot, store);
    assertEqual(got, slug, 'slug is the path with non-alphanumerics replaced');
    const names = dirs.map((d) => path.basename(d)).sort();
    assertDeepEqual(names, [slug, `${slug}--wt-epic-a`, `${slug}--wt-epic-b`].sort(), 'primary + worktree siblings only');
  });

  tmp('discoverTranscriptDirs(): the primary dir comes first when it exists', (root) => {
    const projectRoot = '/c/work/my-app';
    const slug = projectRoot.replace(/[^a-zA-Z0-9]/g, '-');
    const store = path.join(root, 'projects');
    fs.mkdirSync(path.join(store, `${slug}--wt`), { recursive: true });
    fs.mkdirSync(path.join(store, slug), { recursive: true });
    const { dirs } = discoverTranscriptDirs(projectRoot, store);
    assertEqual(path.basename(dirs[0]), slug, 'primary first');
  });

  tmp('discoverTranscriptDirs(): a snapshot dir whose folder name is not the slug still resolves', (root) => {
    // The documented fallback: pointing --transcripts at a copied snapshot must work even
    // though its folder name no longer matches the project path.
    const store = path.join(root, 'snapshot');
    fs.mkdirSync(path.join(store, 'copied-logs'), { recursive: true });
    const { dirs } = discoverTranscriptDirs('/c/work/my-app', store);
    assertDeepEqual(dirs.map((d) => path.basename(d)), ['copied-logs'], 'snapshot subdir used');
  });

  test('discoverTranscriptDirs(): a missing store yields no dirs rather than throwing', () => {
    const { dirs } = discoverTranscriptDirs('/c/work/my-app', path.join(__dirname, 'does-not-exist-report-core-test'));
    assertDeepEqual(dirs, [], 'no dirs');
  });

  // ===========================================================================
  // USAGE RECORDS
  // ===========================================================================

  console.log('\nUsage records:');

  tmp('gatherUsageRecords(): prices input, output and cache tokens into one cost per message', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      // Sonnet 4.6, not Sonnet 5: same list price but no promotional window, so this pins the
      // ARITHMETIC without also depending on where the fixture's timestamp falls relative to a
      // promo end date (promo behaviour is pinned separately below).
      s1: { main: [usageLine({ id: 'm1', model: 'claude-sonnet-4-6', input: 1000, output: 100, cacheRead: 10_000, w5m: 2000 })] },
    });
    const { records } = gatherUsageRecords([dir]);
    assertEqual(records.length, 1, 'one record');
    // Sonnet 4.6: input $3, output $15 → read 0.3, 5m write 3.75 (per 1M).
    close(records[0].cost, (1000 * 3 + 100 * 15 + 10_000 * 0.3 + 2000 * 3.75) / 1e6, 'cost');
    assertEqual(records[0].tokens, 13_100, 'tokens sum input + cacheRead + writes + output');
  });

  tmp('gatherUsageRecords(): sawEstimatedPricing flags a fallback-priced model so the report can say so', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: { main: [usageLine({ id: 'm1', model: 'claude-unreleased-9', output: 100 })] },
    });
    const { records, sawEstimatedPricing } = gatherUsageRecords([dir]);
    assertEqual(sawEstimatedPricing, true, 'an unpriced model marks the run as estimated');
    assertEqual(records[0].estimated, true, 'the individual record is flagged too');
    unknownModels.delete('claude-unreleased-9'); // module state is shared across tests
  });

  tmp('gatherUsageRecords(): sawEstimatedPricing is false when every model is priced', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: { main: [usageLine({ id: 'm1', model: 'claude-opus-4-8', output: 100 })] },
    });
    assertEqual(gatherUsageRecords([dir]).sawEstimatedPricing, false, 'no estimate flag on known models');
  });

  tmp('gatherUsageRecords(): 1h cache writes are priced at 2x via the cache_creation shape', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: { main: [usageLine({ id: 'm1', model: 'claude-opus-4-8', w5m: 1000, w1h: 1000, oneHourShape: true })] },
    });
    const { records } = gatherUsageRecords([dir]);
    // Opus 4.8 input $5 → 5m write 6.25, 1h write 10 (per 1M).
    close(records[0].cost, (1000 * 6.25 + 1000 * 10) / 1e6, '5m and 1h writes priced apart');
  });

  tmp('gatherUsageRecords(): repeated message ids are deduped, so streamed snapshots do not inflate cost', (root) => {
    // Streaming writes the same message id repeatedly, the later line carrying the final usage.
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: {
        main: [
          usageLine({ id: 'm1', input: 100, output: 1 }),
          usageLine({ id: 'm1', input: 100, output: 50 }), // final snapshot wins
          usageLine({ id: 'm2', input: 100, output: 1 }),
        ],
      },
    });
    const { records } = gatherUsageRecords([dir]);
    assertEqual(records.length, 2, 'two distinct messages');
    const m1 = records.find((r) => r.tokens === 150);
    assert(m1, 'the last snapshot of m1 is the one kept');
  });

  tmp('gatherUsageRecords(): synthetic messages, non-assistant lines, usage-less lines and junk are skipped', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: {
        main: [
          usageLine({ id: 'keep', input: 100 }),
          line({ type: 'assistant', timestamp: '2026-07-01T09:00:00Z', message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 999_999 } } }),
          line({ type: 'user', timestamp: '2026-07-01T09:00:00Z', message: { id: 'u1', model: 'claude-sonnet-5', usage: { input_tokens: 999_999 } } }),
          line({ type: 'assistant', timestamp: '2026-07-01T09:00:00Z', message: { id: 'nousage', model: 'claude-sonnet-5' } }),
          '{ not json at all\n',
          '\n',
        ],
      },
    });
    const { records } = gatherUsageRecords([dir]);
    assertEqual(records.length, 1, 'only the real assistant usage record survives');
    assertEqual(records[0].tokens, 100, 'and it is the one we kept');
  });

  tmp('gatherUsageRecords(): a record with no timestamp is dropped (nothing to bucket it into)', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: { main: [line({ type: 'assistant', uuid: 'u', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 100 } } })] },
    });
    const { records } = gatherUsageRecords([dir]);
    assertDeepEqual(records, [], 'no timestamp, no record');
  });

  tmp('gatherUsageRecords(): sub-agent transcripts are read and attributed by agentType', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      s1: {
        main: [usageLine({ id: 'orch', input: 100 })],
        subagents: {
          a1: { lines: [usageLine({ id: 'dev', input: 200 })], meta: JSON.stringify({ agentType: 'developer' }) },
          a2: { lines: [usageLine({ id: 'tg', input: 300 })] },                     // no meta → default label
          a3: { lines: [usageLine({ id: 'broken', input: 400 })], meta: '{oops' },   // corrupt meta → default label
        },
      },
    });
    const { records, sawSubagents } = gatherUsageRecords([dir]);
    assert(sawSubagents, 'sub-agent transcripts detected');
    assertEqual(records.length, 4, 'orchestrator + three sub-agents');
    const byToken = Object.fromEntries(records.map((r) => [r.tokens, r]));
    assertEqual(byToken[100].agent, 'orchestrator', 'main session labelled orchestrator');
    assertEqual(byToken[100].main, true, 'main flag set on the orchestrator record');
    assertEqual(byToken[200].agent, 'developer', 'agentType read from .meta.json');
    assertEqual(byToken[300].agent, 'subagent', 'missing meta falls back to the generic label');
    assertEqual(byToken[400].agent, 'subagent', 'corrupt meta falls back to the generic label');
    assertEqual(byToken[200].main, false, 'sub-agent records are not main');
  });

  tmp('gatherUsageRecords(): sawSubagents is false when only orchestrator logs exist', (root) => {
    // This is the flag both reports use to degrade instead of publishing partial cost.
    const dir = transcriptDir(path.join(root, 'p'), { s1: { main: [usageLine({ id: 'm1', input: 100 })] } });
    const { sawSubagents } = gatherUsageRecords([dir]);
    assertEqual(sawSubagents, false, 'no sub-agent transcripts');
  });

  tmp('gatherUsageRecords(): an excluded session drops its sub-agents too', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), {
      keep: { main: [usageLine({ id: 'k', input: 100 })] },
      drop: { main: [usageLine({ id: 'd', input: 200 })], subagents: { a1: { lines: [usageLine({ id: 'ds', input: 400 })] } } },
    });
    const { records, sawSubagents } = gatherUsageRecords([dir], new Set(['drop']));
    assertEqual(records.length, 1, 'only the kept session contributes');
    assertEqual(records[0].sessionId, 'keep', 'and it is the kept one');
    assertEqual(sawSubagents, false, 'the excluded session\'s sub-agents are not even walked');
  });

  tmp('gatherUsageRecords(): records from several transcript dirs are merged (parallel worktrees)', (root) => {
    const a = transcriptDir(path.join(root, 'primary'), { s1: { main: [usageLine({ id: 'm1', input: 100 })] } });
    const b = transcriptDir(path.join(root, 'worktree'), { s2: { main: [usageLine({ id: 'm2', input: 200 })] } });
    const { records } = gatherUsageRecords([a, b]);
    assertEqual(records.length, 2, 'both dirs contribute');
    assertDeepEqual(records.map((r) => r.sessionId).sort(), ['s1', 's2'], 'session ids preserved');
  });

  tmp('gatherUsageRecords(): non-jsonl files in a transcript dir are ignored', (root) => {
    const dir = transcriptDir(path.join(root, 'p'), { s1: { main: [usageLine({ id: 'm1', input: 100 })] } });
    fs.writeFileSync(path.join(dir, 'notes.md'), 'not a transcript');
    fs.writeFileSync(path.join(dir, 'summary.json'), '{"input_tokens":999999}');
    const { records } = gatherUsageRecords([dir]);
    assertEqual(records.length, 1, 'only the .jsonl file was read');
  });

  summary();
}

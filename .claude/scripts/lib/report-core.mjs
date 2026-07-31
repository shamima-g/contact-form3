// report-core.mjs
//
// Shared building blocks for the log-derived reports (/build-report-cost, /build-report-effort):
// the ONE pricing table, the cache multipliers, the transcript-directory discovery, and
// the deduped usage-record reader. Keeping these here means a new model / price change is
// edited in exactly one place and can't drift between reports.
//
// Both report generators import from here, so a new model or a price change is edited in
// exactly one place and cannot drift between reports.
//
// Pure functions only — no argv parsing, no file writes, no process.exit — so both report
// generators can compose these however they need.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- pricing (USD per 1M tokens). Cache read 0.1x input; cache write 1.25x (5m) / 2x (1h). ----
//
// There is NO pricing API — the Models API (`GET /v1/models`) returns context/output limits and
// a capability tree, but no rates. So this table is hand-maintained: verify any new model's
// prices via the `claude-api` skill (never from memory) and add it here when it shows up in the
// unknown-model warning.
//
// Hardcoding is also the *correct* choice, not just the only one: these reports price
// HISTORICAL token spend, so a run must use the rate that was in effect when the tokens were
// spent. A live lookup would silently re-price old reports whenever rates changed, so the same
// report would disagree with itself between runs.
//
// `promo` is optional, for time-boxed introductory pricing: `{ input, output, until }` (plus an
// optional `from`), where the bounds are EXCLUSIVE-end ISO instants. It applies only when the
// caller passes the spend timestamp to rates() — see the `at` parameter below.
export const CACHE_READ_MULT = 0.1, CACHE_WRITE_5M_MULT = 1.25, CACHE_WRITE_1H_MULT = 2;
export const PRICING = {
  'claude-fable-5':            { input: 10, output: 50, name: 'Fable 5' },
  'claude-mythos-5':           { input: 10, output: 50, name: 'Mythos 5' },
  'claude-opus-5':             { input: 5,  output: 25, name: 'Opus 5' },
  'claude-opus-4-8':           { input: 5,  output: 25, name: 'Opus 4.8' },
  'claude-opus-4-7':           { input: 5,  output: 25, name: 'Opus 4.7' },
  'claude-opus-4-6':           { input: 5,  output: 25, name: 'Opus 4.6' },
  // Sonnet 5 launched on introductory pricing of $2/$10, reverting to list on 2026-09-01.
  'claude-sonnet-5':           { input: 3,  output: 15, name: 'Sonnet 5',
                                 promo: { input: 2, output: 10, until: '2026-09-01T00:00:00Z' } },
  'claude-sonnet-4-6':         { input: 3,  output: 15, name: 'Sonnet 4.6' },
  'claude-haiku-4-5-20251001': { input: 1,  output: 5,  name: 'Haiku 4.5' },
  'claude-haiku-4-5':          { input: 1,  output: 5,  name: 'Haiku 4.5' },
};
export const unknownModels = new Set();

// rates(model[, at]) -> { in, out, read, w5m, w1h, estimated }
//
// `at` is the epoch-ms timestamp of the spend being priced. Pass it whenever you know it: it
// selects the rate that was in effect at that moment. Omit it and you get LIST price — a caller
// that doesn't know when the tokens were spent must not be handed promotional rates.
//
// `estimated` is true when the model isn't in the table and Opus-tier pricing was substituted.
// Callers should surface that in the report rather than presenting the figure as exact.
export function rates(model, at) {
  let p = PRICING[model];
  let estimated = false;
  if (!p) { unknownModels.add(model); p = PRICING['claude-opus-4-8']; estimated = true; }
  let { input, output } = p;
  if (p.promo && at != null) {
    const from = p.promo.from ? Date.parse(p.promo.from) : -Infinity;
    const until = Date.parse(p.promo.until);
    if (at >= from && at < until) { input = p.promo.input; output = p.promo.output; }
  }
  return {
    in: input, out: output,
    read: input * CACHE_READ_MULT, w5m: input * CACHE_WRITE_5M_MULT, w1h: input * CACHE_WRITE_1H_MULT,
    estimated,
  };
}

// ---- transcript directory discovery ----
// Standard store is ~/.claude/projects/<slug>/, where slug = the project's absolute path
// with every non-alphanumeric char replaced by '-'. Sibling dirs whose slug extends this
// one (git-worktree variants: `<slug>--...`) are included too. Pass `transcriptsOverride`
// (a directory holding `<slug>/`) to read a copied snapshot instead of the live store.
export function discoverTranscriptDirs(projectRoot, transcriptsOverride) {
  const slug = projectRoot.replace(/[^a-zA-Z0-9]/g, '-');
  const projectsRoot = transcriptsOverride || path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return { dirs: [], slug, projectsRoot };
  const dirs = [];
  const primary = path.join(projectsRoot, slug);
  if (fs.existsSync(primary)) dirs.push(primary);
  for (const d of fs.readdirSync(projectsRoot)) {
    if (d === slug || !d.startsWith(slug + '--')) continue;
    try { if (fs.statSync(path.join(projectsRoot, d)).isDirectory()) dirs.push(path.join(projectsRoot, d)); } catch { /* skip */ }
  }
  // Fallback: if the override dir directly contains the .jsonl files (single-project snapshot
  // whose folder name isn't the slug), treat it as the one transcript dir.
  if (!dirs.length && transcriptsOverride) {
    const sub = fs.readdirSync(projectsRoot).filter(f => fs.statSync(path.join(projectsRoot, f)).isDirectory());
    for (const s of sub) dirs.push(path.join(projectsRoot, s));
  }
  return { dirs, slug, projectsRoot };
}

// ---- usage records, deduped by message id, across orchestrator + all sub-agents ----
// Returns { records:[{ts, model, cost, tokens, sessionId, agent, main, estimated}], sawSubagents,
// sawEstimatedPricing }.
// `sawSubagents` lets a caller detect the incomplete-log case (no sub-agent transcripts
// captured) and degrade gracefully instead of reporting wrong cost.
// `sawEstimatedPricing` is true when any record's model was missing from PRICING and was priced
// at Opus-tier rates — the report must say so rather than presenting the total as exact.
// Each record is priced at the rate in effect at ITS OWN timestamp, so a run that spans a
// price change (or the end of a promotional window) is costed correctly on both sides of it.
export function gatherUsageRecords(dirs, excludeIds = new Set()) {
  const files = [];
  let sawSubagents = false;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.replace(/\.jsonl$/, '');
      if (excludeIds.has(sid)) continue;
      files.push({ file: path.join(dir, f), sessionId: sid, agent: 'orchestrator', main: true });
      const subDir = path.join(dir, sid, 'subagents');
      if (!fs.existsSync(subDir)) continue;
      for (const sf of fs.readdirSync(subDir)) {
        if (!sf.endsWith('.jsonl')) continue;
        sawSubagents = true;
        let agent = 'subagent';
        const metaFile = path.join(subDir, sf.replace(/\.jsonl$/, '.meta.json'));
        if (fs.existsSync(metaFile)) { try { agent = JSON.parse(fs.readFileSync(metaFile, 'utf8')).agentType || agent; } catch { /* keep default */ } }
        files.push({ file: path.join(subDir, sf), sessionId: sid, agent, main: false });
      }
    }
  }
  const byId = new Map();
  for (const { file, sessionId, agent, main } of files) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== 'assistant' || o.message?.model === '<synthetic>' || !o.message?.usage) continue;
      const id = o.message?.id || o.uuid;
      const u = o.message.usage, cc = u.cache_creation;
      const w5 = cc ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0);
      const w1 = cc ? (cc.ephemeral_1h_input_tokens || 0) : 0;
      const inp = u.input_tokens || 0, cr = u.cache_read_input_tokens || 0, out = u.output_tokens || 0;
      const ts = o.timestamp ? new Date(o.timestamp).getTime() : null;
      // Price at the spend's own timestamp — see rates() on why `at` matters.
      const ra = rates(o.message.model, ts);
      const cost = (inp * ra.in + out * ra.out + cr * ra.read + w5 * ra.w5m + w1 * ra.w1h) / 1e6;
      byId.set(id, { ts, model: o.message.model, cost, tokens: inp + cr + w5 + w1 + out, sessionId, agent, main, estimated: ra.estimated });
    }
  }
  const records = [...byId.values()].filter(r => r.ts);
  return { records, sawSubagents, sawEstimatedPricing: records.some(r => r.estimated) };
}

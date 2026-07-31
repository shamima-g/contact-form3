// Generates the BUILD-EFFORT report — how long and how much each story cost to build,
// grouped by screen type AND rolled up to the feature (epic) level, for ONE project.
// Ground truth only:
//   - time  : per-story startedAt -> completedAt from generated-docs/epics/<slug>/state.json
//   - tokens: every transcript message (orchestrator + sub-agents) bucketed into the story
//             window containing its timestamp; priced with the shared report-core table.
//
// Story figures are measured. Feature/epic figures are those measured stories summed, plus a
// documented pro-rata share of the overhead that sits outside every story window (see UPLIFT
// below) — so an epic total can be compared with, and used to estimate, a whole feature.
//
//   node .claude/skills/build-report-effort/generate-build-effort.mjs [--rate=18.50] [--exclude=id,id]
//                                                              [--transcripts=DIR] [--project-root=DIR]
//
// Writes generated-docs/reports/build-effort.html and build-effort-data.json.
//
// Completeness gate: if no sub-agent transcripts are found (e.g. an older log format that
// only kept the orchestrator), token cost is INCOMPLETE — the report renders time-only and
// says so, rather than printing wrong dollar figures.
import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '../../scripts/lib/project-root.js';
import { discoverTranscriptDirs, gatherUsageRecords, unknownModels } from '../../scripts/lib/report-core.mjs';

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const RATE = parseFloat(args.rate) || null; // ZAR per USD; optional
const EXCLUDE = new Set((typeof args.exclude === 'string' ? args.exclude : '').split(',').map(s => s.trim()).filter(Boolean));
const PROJECT_ROOT = (typeof args['project-root'] === 'string') ? path.resolve(args['project-root']) : getProjectRoot();
const TRANSCRIPTS = (typeof args.transcripts === 'string') ? path.resolve(args.transcripts) : null;

// ---- screen-type taxonomy (edit here to tune classification) ----
// First matching rule wins, so order = priority. Titles come from the story's Playwright
// spec filename. Deliberately title-based, never the epic slug (an epic named "…-export"
// must not tag its listing stories as Export).
const TAXONOMY = [
  { cat: 'Auth / app-shell / infra',  short: 'infra',   re: /bff|proxy|gateway|session|sign ?in|app shell|shell|nav guard|permission|badge|timeout/ },
  { cat: 'Export',                    short: 'export',  re: /export|csv/ },
  { cat: 'Upload / create form',      short: 'form',    re: /upload/ },
  { cat: 'Record action',             short: 'action',  re: /approve|reject|retry|cancel|submit|delete|create|edit|update/ },
  { cat: 'Listing / table page',      short: 'listing', re: /table|overview|filter|search|sort|paginat|card list|\blist\b/ },
  { cat: 'Detail / summary view',     short: 'detail',  re: /summary|detail|validation error|banner|audit|note|state|view/ },
];
const OTHER = { cat: 'Other', short: 'other' };
const classify = title => (TAXONOMY.find(t => t.re.test(title.toLowerCase())) || OTHER).cat;
const SHORT = Object.fromEntries([...TAXONOMY, OTHER].map(t => [t.cat, t.short]));

// ---- stories (time) from epic state files + titles from spec filenames ----
const epicsDir = path.join(PROJECT_ROOT, 'generated-docs', 'epics');
if (!fs.existsSync(epicsDir)) { console.error('No epics at generated-docs/epics/ — nothing to report.'); process.exit(1); }
function specTitles() {
  const dir = path.join(PROJECT_ROOT, 'web', 'e2e'); const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^epic-(.+)-story-(\d+)-(.+)\.spec\.ts$/);
    if (m) map[`${m[1]}|${m[2]}`] = m[3].replace(/-/g, ' ');
  }
  return map;
}
const titles = specTitles();
const stories = [];
for (const slug of fs.readdirSync(epicsDir)) {
  const sf = path.join(epicsDir, slug, 'state.json');
  if (!fs.existsSync(sf)) continue;
  let st; try { st = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch { continue; }
  const epicName = st.epic?.name || slug;
  for (const [n, s] of Object.entries(st.stories || {})) {
    const a = s.startedAt ? new Date(s.startedAt).getTime() : NaN;
    const b = s.completedAt ? new Date(s.completedAt).getTime() : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const title = titles[`${slug}|${n}`] || `story ${n}`;
    stories.push({ epic: slug, epicName, n, title, start: a, end: b, min: (b - a) / 60000, cat: classify(title), cost: 0, tokens: 0, calls: 0 });
  }
}
if (!stories.length) { console.error('No stories with start/complete timestamps found — nothing to report.'); process.exit(1); }
stories.sort((x, y) => x.start - y.start);

// ---- tokens: bucket transcript records into story windows ----
// Epics can be built in parallel (separate branches/worktrees), so story windows OVERLAP and a
// message's timestamp may sit inside several of them. Attributing it to the first match would
// dump all concurrent spend on whichever story started earliest — and at the feature level that
// silently drains one epic into another. With N stories genuinely in flight at that instant the
// logs can't say which one a message served, so the cost is split evenly across the matches and
// the ambiguous share is tracked so the report can flag it.
const { dirs } = discoverTranscriptDirs(PROJECT_ROOT, TRANSCRIPTS);
const { records, sawSubagents, sawEstimatedPricing } = gatherUsageRecords(dirs, EXCLUDE);
let overheadCost = 0, overheadTokens = 0, totalCost = 0, ambiguousCost = 0;
for (const r of records) {
  totalCost += r.cost;
  const hits = stories.filter(st => r.ts >= st.start && r.ts < st.end);
  if (!hits.length) { overheadCost += r.cost; overheadTokens += r.tokens; continue; }
  if (hits.length > 1) ambiguousCost += r.cost;
  for (const s of hits) { s.cost += r.cost / hits.length; s.tokens += r.tokens / hits.length; s.calls++; }
}
// Which stories ran concurrently with a story from a DIFFERENT epic — the case that makes a
// per-feature figure soft, as opposed to two stories of the same epic overlapping.
for (const s of stories) {
  s.parallel = stories.some(o => o !== s && o.epic !== s.epic && o.start < s.end && s.start < o.end);
}
// Completeness is coverage-based, not "does a subagents dir exist": per-story cost is only
// trustworthy if MOST stories actually got token records bucketed into them. A build whose
// sub-agent transcripts weren't captured (old log format) leaves nearly every story at $0,
// even if some unrelated session in the store has a subagents dir. Below the threshold we
// render time-only rather than publish wrong dollar figures.
const COST_COVERAGE_MIN = 0.6;
const storiesWithCost = stories.filter(s => s.cost > 0).length;
const costCoverage = stories.length ? storiesWithCost / stories.length : 0;
const costComplete = sawSubagents && dirs.length > 0 && costCoverage >= COST_COVERAGE_MIN;
const inStoryCost = stories.reduce((a, s) => a + s.cost, 0);

// ---- aggregate per category ----
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sum = a => a.reduce((x, y) => x + y, 0);

// ---- the two uplift factors that turn measured story figures into whole-feature figures ----
//
// Only ~⅓ of a build's spend lands inside story windows; the rest is scaffolding that a feature
// still causes (PLAN, epic-end E2E + fix cycles, PR/merge) or shares (INTAKE, epic decomposition).
// Ground truth can't split that per epic — in a single-session build the overhead messages sit
// between story windows with nothing tying them to one epic, and epics built in parallel
// worktrees overlap in time. So it is allocated pro-rata to measured story cost, which is the
// honest, stated approximation: bigger epics pull more scaffolding.
//
//   costUplift = total spend / in-story spend      -> marginal cost x costUplift = fully loaded
//   timeUplift = summed epic elapsed / summed story minutes
//                (measures the gaps BETWEEN stories inside an epic; PLAN and epic-end aren't
//                 timestamped, so this is a floor on elapsed time, not the whole calendar cost)
const costUplift = inStoryCost > 0 ? totalCost / inStoryCost : 0;

const catOrder = ['Listing / table page', 'Record action', 'Upload / create form', 'Detail / summary view', 'Export', 'Auth / app-shell / infra', 'Other'];
const cats = {};
for (const s of stories) (cats[s.cat] ||= []).push(s);
const categories = catOrder.filter(c => cats[c]).map(c => {
  const g = cats[c];
  const medCost = median(g.map(s => s.cost));
  return {
    cat: c, short: SHORT[c], n: g.length,
    medMin: median(g.map(s => s.min)), meanMin: mean(g.map(s => s.min)),
    medCost, medLoadedCost: medCost * costUplift, medTokens: median(g.map(s => s.tokens)),
  };
});

// ---- roll up to the feature (epic) level ----
// An epic IS the feature in this workflow, so this is the level a new feature gets estimated at.
const byEpic = new Map();
for (const s of stories) {
  let e = byEpic.get(s.epic);
  if (!e) byEpic.set(s.epic, e = { slug: s.epic, name: s.epicName, rows: [], mix: {} });
  e.rows.push(s);
  e.mix[s.cat] = (e.mix[s.cat] || 0) + 1;
}
const epics = [...byEpic.values()].map(e => {
  const start = Math.min(...e.rows.map(s => s.start)), end = Math.max(...e.rows.map(s => s.end));
  const marginalCost = sum(e.rows.map(s => s.cost));
  return {
    slug: e.slug, name: e.name, stories: e.rows.length,
    mix: catOrder.filter(c => e.mix[c]).map(c => ({ cat: c, short: SHORT[c], n: e.mix[c] })),
    buildMinutes: sum(e.rows.map(s => s.min)), medStoryMin: median(e.rows.map(s => s.min)),
    elapsedMinutes: (end - start) / 60000, start, end,
    tokens: sum(e.rows.map(s => s.tokens)),
    marginalCost, loadedCost: marginalCost * costUplift,
    parallel: e.rows.some(s => s.parallel),
  };
}).sort((a, b) => a.start - b.start);
const timeUplift = sum(epics.map(e => e.buildMinutes)) > 0
  ? sum(epics.map(e => e.elapsedMinutes)) / sum(epics.map(e => e.buildMinutes)) : 1;

// Benchmark figures for sizing a NEW feature: the per-type medians above, plus what a typical
// epic in this project looked like as a top-down sanity check on any bottom-up estimate.
const benchmarks = {
  costUplift, timeUplift,
  typicalEpic: {
    // Rounded: a story COUNT, and an even number of epics makes the raw median a half —
    // "3.5 stories" is not a benchmark anyone can size against.
    stories: Math.round(median(epics.map(e => e.stories))),
    buildMinutes: median(epics.map(e => e.buildMinutes)),
    elapsedMinutes: median(epics.map(e => e.elapsedMinutes)),
    marginalCost: median(epics.map(e => e.marginalCost)),
    loadedCost: median(epics.map(e => e.loadedCost)),
  },
};

const result = {
  generatedAt: new Date().toISOString(),
  project: PROJECT_ROOT,
  projectName: (() => { try { const h = fs.readFileSync(path.join(PROJECT_ROOT, 'generated-docs', 'project.md'), 'utf8').split('\n').find(l => /^#\s+/.test(l)); return h ? h.replace(/^#\s+/, '').trim() : ''; } catch { return ''; } })(),
  costComplete, rate: RATE,
  totals: {
    stories: stories.length,
    epics: epics.length,
    buildMinutes: stories.reduce((a, s) => a + s.min, 0),
    medMinutes: median(stories.map(s => s.min)),
    inStoryCost, overheadCost, totalCost,
    overheadShare: totalCost ? overheadCost / totalCost : 0,
    fullyLoadedPerStory: stories.length ? totalCost / stories.length : 0,
    fullyLoadedPerEpic: epics.length ? totalCost / epics.length : 0,
    medCost: median(stories.map(s => s.cost)),
  },
  attribution: {
    ambiguousCost,
    ambiguousShare: inStoryCost ? ambiguousCost / inStoryCost : 0,
    parallelEpics: epics.filter(e => e.parallel).map(e => e.slug),
  },
  benchmarks,
  categories,
  epics,
  stories: stories.map(s => ({ epic: s.epic, n: s.n, title: s.title, cat: s.cat, min: s.min, tokens: s.tokens, cost: s.cost })),
  // Non-empty means a model wasn't in the pricing table and was costed at Opus-tier rates, so the
  // dollar figures are estimates. The report banners this rather than presenting them as exact.
  unknownModels: [...unknownModels],
  pricingEstimated: !!sawEstimatedPricing,
};

const outDir = path.join(PROJECT_ROOT, 'generated-docs', 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'build-effort-data.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(outDir, 'build-effort.html'), renderHtml(result));

// ---- console summary ----
console.log(JSON.stringify({
  stories: result.totals.stories,
  epics: result.totals.epics,
  medMinutesPerStory: +result.totals.medMinutes.toFixed(1),
  costComplete,
  totalCostUsd: +totalCost.toFixed(2),
  inStoryCostUsd: +inStoryCost.toFixed(2),
  overheadSharePct: +(result.totals.overheadShare * 100).toFixed(0),
  fullyLoadedPerStoryUsd: +result.totals.fullyLoadedPerStory.toFixed(2),
  costUplift: +costUplift.toFixed(2),
  timeUplift: +timeUplift.toFixed(2),
  ambiguousSharePct: +(result.attribution.ambiguousShare * 100).toFixed(0),
  parallelEpics: result.attribution.parallelEpics,
  typicalEpic: `${benchmarks.typicalEpic.stories} stories / ${benchmarks.typicalEpic.buildMinutes.toFixed(0)}min build${costComplete ? ' / $' + benchmarks.typicalEpic.loadedCost.toFixed(2) + ' loaded' : ''}`,
  byType: categories.map(c => `${c.cat}: ${c.medMin.toFixed(0)}min${costComplete ? ' / $' + c.medCost.toFixed(2) + ' marginal / $' + c.medLoadedCost.toFixed(2) + ' loaded' : ''} (n=${c.n})`),
  byEpic: epics.map(e => `${e.slug}: ${e.stories} stories / ${e.buildMinutes.toFixed(0)}min build / ${e.elapsedMinutes.toFixed(0)}min elapsed${costComplete ? ' / $' + e.marginalCost.toFixed(2) + ' marginal / $' + e.loadedCost.toFixed(2) + ' loaded' : ''}`),
  unknownModels: result.unknownModels,
}, null, 1));
if (!costComplete) console.warn('WARNING: no sub-agent transcripts found — token cost is INCOMPLETE; report shows build time only.');
// Overlap is reported whatever its source, but the CAUSE differs and only the cross-epic case
// softens a per-feature figure — so never name parallel features when there are none to name.
if (result.attribution.ambiguousShare > 0.05) console.warn(`NOTE: ${(result.attribution.ambiguousShare * 100).toFixed(0)}% of story spend fell inside overlapping story windows (${result.attribution.parallelEpics.length ? `features built in parallel: ${result.attribution.parallelEpics.join(', ')}` : 'all within a single feature'}) — split evenly across the stories in flight, so per-feature splits are approximate.`);
if (unknownModels.size) console.warn('WARNING: unknown models priced as Opus 4.8 — add them to PRICING in report-core.mjs: ' + [...unknownModels].join(', '));
console.log('written generated-docs/reports/build-effort.html');

// ---- HTML (self-contained, theme-aware) ----
function renderHtml(r) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const usd = n => '$' + n.toFixed(2);
  const zar = n => r.rate ? ' · R' + (n * r.rate).toFixed(0) : '';
  const Mtok = n => (n / 1e6).toFixed(1) + 'M';
  const costCol = r.costComplete;
  const t = r.totals;
  const b = r.benchmarks;
  const dur = m => m < 90 ? m.toFixed(0) + ' min' : (m / 60).toFixed(1) + ' h';
  const catRows = r.categories.map(c => `<tr><td class="name">${esc(c.cat)}${c.n === 1 ? ' <span class="flag">n=1</span>' : ''}</td><td class="num">${c.medMin.toFixed(0)} min</td>${costCol ? `<td class="num">${Mtok(c.medTokens)}</td><td class="num">${usd(c.medCost)}</td><td class="num">${usd(c.medLoadedCost)}</td>` : ''}<td class="num">${c.n}</td></tr>`).join('');
  const epicRows = r.epics.map(e => `<tr><td class="name">${esc(e.name)}${e.parallel ? ' <span class="flag" title="built in parallel with another feature — cost split is approximate">∥</span>' : ''}<span class="sub">${esc(e.slug)}</span></td><td class="num">${e.stories}</td><td class="mix">${e.mix.map(m => `${m.n}&times;${esc(m.short)}`).join(', ')}</td><td class="num">${dur(e.buildMinutes)}</td><td class="num">${dur(e.elapsedMinutes)}</td>${costCol ? `<td class="num">${usd(e.marginalCost)}</td><td class="num">${usd(e.loadedCost)}${zar(e.loadedCost)}</td>` : ''}</tr>`).join('');
  const storyRows = r.stories.map(s => `<tr><td class="name">${esc(s.title)}</td><td class="sub-cell">${esc(s.epic)}</td><td>${esc(s.cat)}</td><td class="num">${s.min.toFixed(1)}</td>${costCol ? `<td class="num">${Mtok(s.tokens)}</td><td class="num">${usd(s.cost)}</td>` : ''}</tr>`).join('');
  const estRows = r.categories.map((c, i) => `<tr><td class="name">${esc(c.cat)}${c.n === 1 ? ' <span class="flag">n=1</span>' : ''}</td><td class="num">${c.medMin.toFixed(0)} min${costCol ? ' · ' + usd(c.medLoadedCost) : ''}</td><td class="num"><input type="number" min="0" step="1" value="0" data-i="${i}" aria-label="How many ${esc(c.cat)} screens"></td><td class="num" id="sub${i}">—</td></tr>`).join('');
  const EST = JSON.stringify({
    cats: r.categories.map(c => ({ medMin: c.medMin, medCost: c.medCost, medLoaded: c.medLoadedCost })),
    timeUplift: b.timeUplift, cost: costCol, rate: r.rate,
  });
  const incompleteBanner = costCol ? '' : `<div class="callout warn"><h3>Token cost unavailable for this project</h3><p>No sub-agent transcripts were found in the logs, so per-story token cost can't be reconstructed. Showing <b>build time only</b>. (This happens with older log formats that kept only the orchestrator session.)</p></div>`;
  // A fallback-priced model must never look exact — say so on the page, not just in the console.
  const estimatedBanner = (costCol && r.pricingEstimated)
    ? `<div class="callout warn"><h3>Costs below are estimates</h3><p>${(r.unknownModels || []).map(esc).join(', ')} ${(r.unknownModels || []).length === 1 ? "isn't" : "aren't"} in the report's price list, so ${(r.unknownModels || []).length === 1 ? 'it was' : 'they were'} costed at Opus-tier rates. Treat the dollar figures as approximate until the price list is updated; the times are unaffected.</p></div>`
    : '';
  const a = r.attribution;
  // Two causes, two sentences. Cross-epic overlap is the one that softens a per-feature figure;
  // same-epic overlap (a re-opened story window) leaves the feature split intact, so claiming
  // "0 of N features were built in parallel ()" would be both empty and wrong.
  const overlapCause = a.parallelEpics.length
    ? `${a.parallelEpics.length} of ${r.epics.length} features were built in parallel (${a.parallelEpics.map((s) => esc(s)).join(', ')}), so their story windows overlap and the logs can't say which story a given message served. That spend is split evenly across the stories open at the time. Per-<em>type</em> and project totals hold; treat the per-feature split for those features as approximate.`
    : `The overlapping windows all sit inside a single feature, so no feature's total is affected — but the split between its individual stories is. That spend is divided evenly across the stories open at the time; per-feature, per-<em>type</em> and project totals all hold.`;
  const parallelBanner = (costCol && a.ambiguousShare > 0.05) ? `<div class="callout"><h3>${(a.ambiguousShare * 100).toFixed(0)}% of story spend ran with more than one story in flight</h3><p>${overlapCause}</p></div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Build Effort — ${esc(r.projectName || 'project')}</title>
<style>
:root{--bg:#f6f8f9;--surface:#fff;--surface-2:#edf1f2;--ink:#161a1c;--ink-2:#515a5e;--ink-3:#7b858a;--line:#dbe1e3;--accent:#0f766e;--accent-soft:#d6ebe8;--warn:#92610f;--warn-soft:#f3e7cf;--shadow:0 1px 2px rgba(20,30,35,.05),0 6px 20px -8px rgba(20,30,35,.12);--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;}
@media (prefers-color-scheme:dark){:root{--bg:#101416;--surface:#171c1e;--surface-2:#1f2528;--ink:#eef2f3;--ink-2:#a7b1b5;--ink-3:#778287;--line:#2a3236;--accent:#34d0be;--accent-soft:#123531;--warn:#e2b35a;--warn-soft:#2f2611;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px -10px rgba(0,0,0,.5);}}
:root[data-theme="light"]{--bg:#f6f8f9;--surface:#fff;--surface-2:#edf1f2;--ink:#161a1c;--ink-2:#515a5e;--ink-3:#7b858a;--line:#dbe1e3;--accent:#0f766e;--warn:#92610f;--warn-soft:#f3e7cf;}
:root[data-theme="dark"]{--bg:#101416;--surface:#171c1e;--surface-2:#1f2528;--ink:#eef2f3;--ink-2:#a7b1b5;--ink-3:#778287;--line:#2a3236;--accent:#34d0be;--warn:#e2b35a;--warn-soft:#2f2611;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:clamp(20px,5vw,56px) clamp(16px,4vw,36px) 64px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 12px}
h1{font-size:clamp(26px,4.5vw,38px);line-height:1.08;letter-spacing:-.02em;font-weight:800;margin:0 0 14px;text-wrap:balance}
.lede{font-size:16px;color:var(--ink-2);max-width:64ch;margin:0}
.meta{font-family:var(--mono);font-size:12px;color:var(--ink-3);margin-top:16px}
section{margin-top:44px}h2{font-size:13px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.14em;color:var(--ink-3);font-weight:600;margin:0 0 16px;padding-bottom:9px;border-bottom:1px solid var(--line)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:13px;margin-top:24px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:17px;box-shadow:var(--shadow)}
.tile.accent{border-color:var(--accent)}.tile .k{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:0 0 7px}
.tile .v{font-size:27px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1}.tile.accent .v{color:var(--accent)}.tile .v small{font-size:13px;font-weight:600;color:var(--ink-2)}.tile .note{font-size:12px;color:var(--ink-2);margin:8px 0 0}
.tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:11px 15px;border-bottom:1px solid var(--line);white-space:nowrap}
thead th{font-family:var(--mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);font-weight:600;background:var(--surface-2)}
tbody tr:last-child td{border-bottom:none}td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}td.name{white-space:normal}
.flag{color:var(--warn);font-family:var(--mono);font-size:11px}
td .sub{display:block;font-family:var(--mono);font-size:11px;color:var(--ink-3)}td.sub-cell{font-family:var(--mono);font-size:12px;color:var(--ink-2)}
td.mix{font-family:var(--mono);font-size:12px;color:var(--ink-2);white-space:normal}
tfoot td{font-weight:700;background:var(--surface-2);border-bottom:none}
input[type=number]{width:5.5em;font-family:var(--mono);font-size:14px;text-align:right;padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink)}
input[type=number]:focus{outline:2px solid var(--accent);outline-offset:1px}
p.hint{font-size:14px;color:var(--ink-2);margin:0 0 16px;max-width:70ch}
.callout{border-radius:12px;padding:20px 22px;border:1px solid var(--line);border-left:4px solid var(--warn);background:color-mix(in srgb,var(--warn-soft) 55%,var(--surface));box-shadow:var(--shadow);margin-top:20px}
.callout h3{margin:0 0 8px;font-size:15px}.callout p{margin:0;font-size:14px;color:var(--ink-2)}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-3);font-family:var(--mono);line-height:1.7}footer b{color:var(--ink-2)}
</style></head><body><div class="wrap">
<p class="eyebrow">Delivery metrics · AI build effort</p>
<h1>Build effort by feature and screen type${r.projectName ? ' — ' + esc(r.projectName) : ''}</h1>
<p class="lede">Per-story build time${costCol ? ' and token cost' : ''}, reconstructed from the workflow's own timestamps${costCol ? ' and token logs' : ''}, rolled up to each feature so a new one can be sized against it.</p>
<p class="meta">${r.totals.epics} features · ${r.totals.stories} stories · median ${t.medMinutes.toFixed(0)} min/story${costCol ? ` · ${usd(t.medCost)} median cost/story` : ''} · generated ${esc(r.generatedAt.slice(0, 10))}</p>
${incompleteBanner}${estimatedBanner}${parallelBanner}
<div class="tiles">
<div class="tile accent"><p class="k">Typical feature</p><p class="v">${b.typicalEpic.stories} <small>stories</small></p><p class="note">median ${dur(b.typicalEpic.buildMinutes)} of build time</p></div>
${costCol ? `<div class="tile accent"><p class="k">Typical feature cost</p><p class="v">${usd(b.typicalEpic.loadedCost)}${zar(b.typicalEpic.loadedCost)}</p><p class="note">median, fully loaded (${usd(b.typicalEpic.marginalCost)} marginal)</p></div>
<div class="tile"><p class="k">Typical story</p><p class="v">${t.medMinutes.toFixed(0)} <small>min</small></p><p class="note">median ${usd(t.medCost)} marginal cost</p></div>
<div class="tile"><p class="k">Overhead uplift</p><p class="v">${b.costUplift.toFixed(1)}<small>×</small></p><p class="note">${(t.overheadShare * 100).toFixed(0)}% of spend is outside story windows</p></div>` : `<div class="tile"><p class="k">Typical story</p><p class="v">${t.medMinutes.toFixed(0)} <small>min</small></p><p class="note">median build time</p></div>
<div class="tile"><p class="k">Total build time</p><p class="v">${(t.buildMinutes / 60).toFixed(1)} <small>h</small></p><p class="note">summed across stories</p></div>`}
</div>
<section><h2>Rolled up by feature</h2>
<p class="hint">Each epic is one feature. <b>Build time</b> sums its stories' measured windows; <b>elapsed</b> is first story start → last story end, so it includes the gaps between stories but not PLAN or epic-end.${a.parallelEpics.length ? ' <span class="flag">∥</span> marks features built in parallel with another, where the cost split between them is approximate.' : ''}${costCol ? ` <b>Marginal</b> is what landed inside those story windows; <b>fully loaded</b> adds this project's ${b.costUplift.toFixed(1)}× share of the scaffolding around them.` : ''}</p>
<div class="tblwrap"><table>
<thead><tr><th>Feature (epic)</th><th class="num">Stories</th><th>Mix</th><th class="num">Build time</th><th class="num">Elapsed</th>${costCol ? '<th class="num">Marginal</th><th class="num">Fully loaded</th>' : ''}</tr></thead>
<tbody>${epicRows}</tbody>
<tfoot><tr><td>All ${r.epics.length} features</td><td class="num">${t.stories}</td><td></td><td class="num">${dur(t.buildMinutes)}</td><td class="num">—</td>${costCol ? `<td class="num">${usd(t.inStoryCost)}</td><td class="num">${usd(t.totalCost)}</td>` : ''}</tr></tfoot>
</table></div></section>
<section><h2>Rule of thumb by screen type</h2><div class="tblwrap"><table>
<thead><tr><th>Screen type</th><th class="num">~ Time</th>${costCol ? '<th class="num">~ Tokens</th><th class="num">~ Marginal</th><th class="num">~ Fully loaded</th>' : ''}<th class="num">n</th></tr></thead>
<tbody>${catRows}</tbody></table></div></section>
<section><h2>Size a new feature</h2>
<p class="hint">Count the screens the new feature needs and enter them below — the estimate uses this project's measured medians${costCol ? `, uplifted ${b.costUplift.toFixed(1)}× for scaffolding` : ''}. Cross-check the result against the "typical feature" figures above${r.categories.some(c => c.n === 1) ? '; types marked <span class="flag">n=1</span> rest on a single measurement' : ''}.</p>
<div class="tblwrap"><table>
<thead><tr><th>Screen type</th><th class="num">Each</th><th class="num">How many</th><th class="num">Subtotal</th></tr></thead>
<tbody>${estRows}</tbody></table></div>
<div class="tiles">
<div class="tile accent"><p class="k">Stories</p><p class="v" id="oStories">0</p><p class="note">screens in the feature</p></div>
<div class="tile accent"><p class="k">AI build time</p><p class="v" id="oTime">—</p><p class="note">≈ <span id="oElapsed">—</span> elapsed at this project's ${b.timeUplift.toFixed(2)}× for gaps between stories</p></div>
${costCol ? `<div class="tile"><p class="k">Marginal cost</p><p class="v" id="oMarginal">—</p><p class="note">inside story windows only</p></div>
<div class="tile"><p class="k">Fully-loaded cost</p><p class="v" id="oLoaded">—</p><p class="note">use this one for budgeting</p></div>` : ''}
</div>
<script>
const EST=${EST};
const dur=m=>m<90?m.toFixed(0)+' min':(m/60).toFixed(1)+' h';
const usd=n=>'$'+n.toFixed(2);
const zar=n=>EST.rate?' · R'+(n*EST.rate).toFixed(0):'';
const inputs=[...document.querySelectorAll('input[data-i]')];
function recalc(){
  let n=0,min=0,marg=0,load=0;
  for(const el of inputs){
    const q=Math.max(0,parseInt(el.value,10)||0), c=EST.cats[+el.dataset.i];
    n+=q; min+=q*c.medMin; marg+=q*c.medCost; load+=q*c.medLoaded;
    document.getElementById('sub'+el.dataset.i).textContent=q?dur(q*c.medMin)+(EST.cost?' · '+usd(q*c.medLoaded):''):'—';
  }
  document.getElementById('oStories').textContent=n;
  document.getElementById('oTime').textContent=n?dur(min):'—';
  document.getElementById('oElapsed').textContent=n?dur(min*EST.timeUplift):'—';
  if(EST.cost){
    document.getElementById('oMarginal').textContent=n?usd(marg):'—';
    document.getElementById('oLoaded').textContent=n?usd(load)+zar(load):'—';
  }
}
inputs.forEach(el=>el.addEventListener('input',recalc));
recalc();
</script></section>
${costCol ? `<section><h2>Marginal vs fully-loaded</h2><div class="callout"><h3>Only ${(100 - t.overheadShare * 100).toFixed(0)}% of spend lands inside stories</h3><p>Of ${usd(t.totalCost)} total, ${usd(t.inStoryCost)} fell inside per-story build windows; ${usd(t.overheadCost)} is workflow scaffolding (INTAKE, PLAN, epic-end E2E + fixes, PR/merge, orchestrator context between stories). <b>Marginal</b> cost of one more screen ≈ the rule-of-thumb table; <b>fully-loaded</b> multiplies it by ${b.costUplift.toFixed(1)}× — ≈ ${usd(t.fullyLoadedPerStory)}/story or ${usd(t.fullyLoadedPerEpic)}/feature on average. That scaffolding can't be split per feature from the logs, so each feature carries a share proportional to its measured story spend.</p></div></section>` : ''}
<section><h2>Every story, measured</h2><div class="tblwrap"><table>
<thead><tr><th>Story</th><th>Feature</th><th>Type</th><th class="num">Time (min)</th>${costCol ? '<th class="num">Tokens</th><th class="num">Cost</th>' : ''}</tr></thead>
<tbody>${storyRows}</tbody></table></div></section>
<footer>Time from each epic's state.json (startedAt→completedAt). Titles from Playwright spec filenames. ${costCol ? 'Token cost by bucketing every transcript message (orchestrator + sub-agents) into its story window; list API prices, cache read 0.1×, write 1.25×/2×. Overhead = spend outside all story windows, allocated to features pro-rata to their story spend (' + b.costUplift.toFixed(2) + '× uplift) — an allocation, not a measurement.' : 'Token cost omitted — sub-agent transcripts absent.'} Feature <b>build time</b> is summed story windows; <b>elapsed</b> is first story start → last story end and excludes PLAN and epic-end. Measures AI build effort only; excludes human review / manual-test wall-time. Single project — directional, firms up as more projects are measured.</footer>
</div></body></html>`;
}

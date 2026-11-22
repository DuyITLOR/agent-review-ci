#!/usr/bin/env node
// npm run measure                 live: run the gate and call the reviewer, record everything
// npm run measure -- --replay     no key: re-run the gate, re-score the recorded replies
// Options: --runs N (default 5), --only <patch id,...>
//
// For every run and every patch in corpus/manifest.json:
//   1. copy app/ to a fresh temp dir, apply the patch
//   2. baseline: `npm run check` (lint, format, unit, contract): did the gate go red?
//   3. change:   the reviewer reads the diff and the contract: did it block, on the right line?
// Raw output goes to results/run-<n>/ (live) or results/replay/run-<n>/ (replay);
// the model's replies go to results/raw/run-<n>/, which is what replay reads.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP, ROOT, baseline } from './gate.js';
import { call, config, parse } from '../reviewer/index.js';
import { scoreAgent } from './score.js';
import { acrossRuns, runMetrics, toMarkdown } from './summarize.js';

const RESULTS = join(ROOT, 'results');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const REPLAY = args.includes('--replay');
const RUNS = Number(opt('runs', 5));
const ONLY = opt('only', null)?.split(',');
const MAX_USD = Number(process.env.MAX_USD ?? 2);

const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/manifest.json'), 'utf8'));
const patches = manifest.patches.filter((p) => !ONLY || ONLY.includes(p.id));
const contract = readFileSync(join(APP, 'docs/contract/publish.md'), 'utf8');
const cfg = config();

if (!existsSync(join(APP, 'node_modules'))) {
  console.error('Run `npm ci --prefix app` first (see README.md).');
  process.exit(2);
}
if (!REPLAY && (!cfg.provider || !cfg.model)) {
  console.error('Set REVIEWER_PROVIDER and REVIEWER_MODEL, or use --replay (see README.md).');
  process.exit(2);
}

const writeJson = (path, data) => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

async function agent(patch, diff, run) {
  const rawPath = join(RESULTS, 'raw', `run-${run}`, `${patch.id}.json`);
  let rec;
  if (REPLAY) {
    if (!existsSync(rawPath)) throw new Error(`no recorded reply at ${rawPath}`);
    rec = JSON.parse(readFileSync(rawPath, 'utf8'));
  } else {
    rec = await call({ diff, contract }, cfg);
    writeJson(rawPath, { patch: patch.id, run, recordedAt: new Date().toISOString(), ...rec });
  }
  const verdict = parse(rec.text);
  return { meta: rec, verdict, score: scoreAgent(patch, diff, verdict) };
}

const outDir = REPLAY ? join(RESULTS, 'replay') : RESULTS;
const perRun = [];
let spent = 0;
let meta = { provider: cfg.provider, model: cfg.model, temperature: cfg.temperature };

for (let run = 1; run <= RUNS; run++) {
  const records = [];
  for (const patch of patches) {
    const diff = patch.file ? readFileSync(join(ROOT, 'corpus', patch.file), 'utf8') : '';
    const b = baseline(patch);
    const a = await agent(patch, diff, run);
    meta = { provider: a.meta.provider, model: a.meta.model, temperature: a.meta.temperature };
    spent += a.meta.usage.usd;
    const record = {
      patch: { id: patch.id, kind: patch.kind, category: patch.category, rule: patch.rule },
      run,
      baseline: { failed: b.failed, ms: b.ms, failing: b.failing, lintOrFormat: b.lintOrFormat },
      agent: { ...a.score, ms: a.meta.usage.ms, usd: a.meta.usage.usd, inTok: a.meta.usage.inTok, outTok: a.meta.usage.outTok, findingsDetail: a.verdict.findings },
      expectedTestsCatch: patch.testsCatch ?? null,
    };
    writeJson(join(outDir, `run-${run}`, `${patch.id}.json`), { ...record, baselineOutputTail: b.outputTail });
    records.push(record);
    const mark = patch.kind === 'bug' ? (record.agent.caught ? 'agent:caught' : 'agent:missed') : record.agent.falseAlarm ? 'agent:FALSE-ALARM' : 'agent:ok';
    console.log(`run ${run} ${patch.id.padEnd(5)} ${patch.kind.padEnd(5)} tests:${b.failed ? 'red  ' : 'green'} ${mark}`);
    if (!REPLAY && spent > MAX_USD) {
      console.error(`Stopped: spent ${spent.toFixed(4)} USD, over MAX_USD=${MAX_USD}.`);
      process.exit(3);
    }
  }
  const m = runMetrics(records);
  writeJson(join(outDir, `run-${run}`, '_metrics.json'), m);
  perRun.push(m);
}

const summary = acrossRuns(perRun);
const info = { ...meta, runs: RUNS, mode: REPLAY ? 'replay' : 'live', generatedAt: new Date().toISOString(), patches: patches.length };
writeJson(join(outDir, 'summary.json'), { info, summary });
const md = toMarkdown(summary, info);
writeFileSync(join(outDir, 'summary.md'), md);
console.log('\n' + md);

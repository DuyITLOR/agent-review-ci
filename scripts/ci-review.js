#!/usr/bin/env node
// npm run review -- <base-ref>
// The reviewer as a CI step: review `git diff <base-ref>...HEAD -- app/`, write the verdict to
// review.md (posted as a PR comment by the workflow), exit 1 if it blocks.
//
// Gate behaviour (the same as the measurement scores it):
// - Fail-open: no reviewer configured, an API error, or a reply that is not valid JSON never
//   blocks. The test job is the deterministic gate; this step only adds to it.
// - REVIEWER_MODE=warn: comment the findings, never fail the job (calibration).
// - REVIEWER_MAX_DIFF_LINES (default 1500): a larger diff is not reviewed, and says so.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config, review } from '../reviewer/index.js';
import { ROOT, APP } from './gate.js';

const base = process.argv[2] ?? 'origin/main';
const WARN = process.env.REVIEWER_MODE === 'warn';
const MAX_LINES = Number(process.env.REVIEWER_MAX_DIFF_LINES ?? 1500);

function done(md, code) {
  writeFileSync('review.md', `### Agent review\n\n${md}\n`);
  console.log(md);
  process.exit(WARN ? 0 : code);
}

const diff = execFileSync('git', ['diff', '--relative=app', `${base}...HEAD`, '--', 'app/'], {
  cwd: ROOT,
  encoding: 'utf8',
});
if (!diff.trim()) done('No change under `app/`. Nothing to review.', 0);

const lines = diff.split('\n').length;
if (lines > MAX_LINES) {
  done(`Diff has ${lines} lines, over REVIEWER_MAX_DIFF_LINES=${MAX_LINES}: not reviewed.`, 0);
}

const cfg = config();
if (!cfg.provider || !cfg.model) {
  done('No reviewer configured (REVIEWER_PROVIDER / REVIEWER_MODEL): skipped, not blocking.', 0);
}

let r;
try {
  r = await review({ diff, contract: readFileSync(join(APP, 'docs/contract/publish.md'), 'utf8') });
} catch (e) {
  done(`Reviewer failed: ${e.message.slice(0, 300)}\n\nSkipped, not blocking.`, 0);
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const rows = r.findings
  .map((f) => `| \`${cell(f.file)}\` | \`${cell(f.quote)}\` | ${cell(f.rule)} | ${cell(f.reason)} |`)
  .join('\n');
const head = r.parseError
  ? '⚠️ The reply was not valid JSON: not blocking.'
  : r.block
    ? `❌ **block**${WARN ? ' (warn mode: not failing the job)' : ''}`
    : '✅ pass';
done(
  [
    head,
    '',
    `model \`${r.model}\` · ${r.usage.ms} ms · ${r.usage.inTok}+${r.usage.outTok} tokens · ${r.usage.usd.toFixed(4)} USD`,
    '',
    r.findings.length ? '| File | Line | Rule | Why |\n|---|---|---|---|\n' + rows : 'No findings.',
  ].join('\n'),
  r.block && !r.parseError ? 1 : 0,
);

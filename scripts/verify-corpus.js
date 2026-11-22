#!/usr/bin/env node
// npm run verify-corpus
// Checks the corpus before any measurement: the clean app passes the gate, every patch
// applies, and whether the tests catch each patch matches `testsCatch` in the manifest.
// No reviewer, no key.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, baseline, probe } from './gate.js';

const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus/manifest.json'), 'utf8'));
let bad = 0;

const clean = baseline({ id: 'clean-app' });
console.log(`clean app       gate:${clean.failed ? 'RED (must be green!)' : 'green'}`);
if (clean.failed) bad++;

for (const p of manifest.patches) {
  let b;
  try {
    b = baseline(p);
  } catch (e) {
    console.log(`${p.id.padEnd(5)} ${p.kind.padEnd(5)} DOES NOT APPLY: ${e.message.split('\n')[0]}`);
    bad++;
    continue;
  }
  const expected = p.kind === 'clean' ? false : p.testsCatch;
  const ok = b.failed === expected;
  if (!ok) bad++;
  const why = b.failing.length ? ` (${b.failing.join('; ')})` : b.lintOrFormat ? ' (lint/format)' : '';
  console.log(
    `${p.id.padEnd(5)} ${p.kind.padEnd(5)} tests:${b.failed ? 'red  ' : 'green'} expected:${expected ? 'red  ' : 'green'} ${ok ? 'ok' : 'MISMATCH'}${why}`,
  );

  // A bug the tests miss needs evidence: its probe passes on the clean app, fails on the patch.
  if (p.kind === 'bug' && !p.testsCatch) {
    const onClean = probe(p.id);
    const onPatch = probe(p.id, p);
    const real = onClean.passed && !onPatch.passed;
    if (!real) bad++;
    console.log(
      `      probe: clean ${onClean.passed ? 'pass' : 'FAIL'} · patched ${onPatch.passed ? 'PASS' : 'fail'} → ${real ? 'real bug' : 'NOT SHOWN: ' + onClean.output + ' / ' + onPatch.output}`,
    );
  }
}

const bugs = manifest.patches.filter((p) => p.kind === 'bug');
console.log(
  `\n${bugs.length} bug patches (${bugs.filter((p) => p.testsCatch).length} caught by tests, ${bugs.filter((p) => !p.testsCatch).length} missed), ${manifest.patches.length - bugs.length} clean.`,
);
process.exit(bad ? 1 : 0);

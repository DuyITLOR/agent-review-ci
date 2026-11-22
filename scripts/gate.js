// The baseline gate: copy app/ to a fresh temp dir, apply one patch, run `npm run check`.

import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const APP = join(ROOT, 'app');

// Run fn(dir) on a fresh copy of app/ with the patch applied (no patch: the clean app).
export function withPatchedApp(patch, fn) {
  const dir = mkdtempSync(join(tmpdir(), `arc-${patch.id}-`));
  try {
    cpSync(APP, dir, { recursive: true, filter: (src) => !src.includes('node_modules') });
    symlinkSync(join(APP, 'node_modules'), join(dir, 'node_modules'), 'dir');
    if (patch.file) {
      const a = spawnSync(
        'git',
        ['apply', '--whitespace=nowarn', join(ROOT, 'corpus', patch.file)],
        { cwd: dir, encoding: 'utf8' },
      );
      if (a.status !== 0) throw new Error(`patch ${patch.id} does not apply: ${a.stderr}`);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function baseline(patch) {
  return withPatchedApp(patch, (dir) => {
    const t0 = performance.now();
    const r = spawnSync('npm', ['run', 'check'], { cwd: dir, encoding: 'utf8' });
    const ms = Math.round(performance.now() - t0);
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    const failing = [
      ...new Set(
        out
          .split('\n')
          .filter((l) => /^\s*✖ /.test(l) && !/failing tests/.test(l))
          .map((l) => l.trim().replace(/ \([\d.]+ms\)$/, '')),
      ),
    ];
    return {
      failed: r.status !== 0,
      ms,
      failing,
      lintOrFormat: r.status !== 0 && failing.length === 0,
      outputTail: out.split('\n').slice(-40).join('\n'),
    };
  });
}

// The probe for one bug (corpus/probes.mjs), run against the clean or the patched app.
export function probe(id, patch) {
  return withPatchedApp(patch ?? { id: `clean-${id}` }, (dir) => {
    const r = spawnSync(
      process.execPath,
      ['--no-warnings', join(ROOT, 'corpus/probes.mjs'), id],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, APP_DIR: dir } },
    );
    return { passed: r.status === 0, output: (r.stdout + r.stderr).trim() };
  });
}

#!/usr/bin/env node
// Builds corpus/*.patch and corpus/manifest.json from the edits below.
// Each entry is one fake pull request against the clean app in app/.
//
//   node corpus/build-corpus.mjs && npm run verify-corpus
//
// Every edit must match exactly once, or the build stops. Edited files are run through
// prettier, so a patch never goes red for formatting alone.

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const APP = join(ROOT, 'app');
const OUT = join(ROOT, 'corpus');

const APPJS = 'src/app.js';
const HTTP = 'src/http.js';
const GRADES = 'src/grades.js';

// [file, find, replace]; find may be a RegExp with the g flag for a rename.
const PATCHES = [
  // ── bugs the tests catch ─────────────────────────────────────────────────────────────
  {
    id: 'b01', kind: 'bug', category: 'pending-409', testsCatch: true,
    rule: 'It refuses while reviews are pending (409): the pending check is deleted.',
    edits: [[APPJS, `      if (!lab.published_at) {
        const pending = q.byLab
          .all(lab.id)
          .filter((s) => needsReview(s.verdict) && !s.decision).length;
        if (pending > 0) {
          return problem(res, 409, 'reviews-pending', 'Reviews are pending', { pending });
        }
      }
`, '']],
  },
  {
    id: 'b03', kind: 'bug', category: 'authz', testsCatch: true,
    rule: 'A student enrolled in the class must get 403; this returns 404.',
    edits: [[APPJS, `return problem(res, 403, 'forbidden', 'Only staff of this class may publish');`, `return problem(res, 404, 'not-found', 'No such lab');`]],
  },
  {
    id: 'b04', kind: 'bug', category: 'refused-changes-nothing', testsCatch: true,
    rule: 'A refused call changes nothing: published_at is written before the access check.',
    edits: [
      [APPJS, `      if (!lab) return problem(res, 404, 'not-found', 'No such lab');
      if (!isStaff(me, lab.class_id)) {`, `      if (!lab) return problem(res, 404, 'not-found', 'No such lab');
      // Mark it first, so a double click on Publish cannot race.
      q.publish.run(lab.id);
      if (!isStaff(me, lab.class_id)) {`],
      [APPJS, `      // The WHERE clause keeps a second click from moving the time.
      q.publish.run(lab.id);
`, ''],
    ],
  },
  {
    id: 'b05', kind: 'bug', category: 'authz', testsCatch: true,
    rule: 'An admin may publish; isStaff no longer lets admins through.',
    edits: [[APPJS, `const isStaff = (me, classId) => me.role === 'admin' || !!q.staff.get(classId, me.id);`, `const isStaff = (me, classId) => !!q.staff.get(classId, me.id);`]],
  },
  {
    id: 'b06', kind: 'bug', category: 'error-format', testsCatch: true,
    rule: 'Every error is application/problem+json; errors are sent as application/json.',
    edits: [[HTTP, `res.writeHead(status, { 'content-type': 'application/problem+json' });`, `res.writeHead(status, { 'content-type': 'application/json' });`]],
  },
  {
    id: 'b07', kind: 'bug', category: 'idempotency', testsCatch: true,
    rule: 'It is safe to repeat: without the published_at IS NULL guard a second call moves the time.',
    edits: [[APPJS, ` WHERE id = ? AND published_at IS NULL"`, ` WHERE id = ?"`]],
  },
  {
    id: 'b08', kind: 'bug', category: 'grading-logic', testsCatch: true,
    rule: 'An overturned violation takes off nothing; markFor now deducts it.',
    edits: [[GRADES, `.filter((v) => v.verdict === 'violation' && v.decision !== 'overturn')`, `.filter((v) => v.verdict === 'violation')`]],
  },
  {
    id: 'b09', kind: 'bug', category: 'grading-logic', testsCatch: true,
    rule: 'Every unsure verdict must go to the TA; needsReview drops unsure.',
    edits: [[GRADES, `return verdict === 'violation' || verdict === 'unsure';`, `return verdict === 'violation';`]],
  },
  {
    id: 'b10', kind: 'bug', category: 'authn', testsCatch: true,
    rule: 'No token or an unknown token is 401; this answers 404.',
    edits: [[APPJS, `if (!me) return problem(res, 401, 'unauthenticated', 'Sign in first');`, `if (!me) return problem(res, 404, 'not-found', 'No such route');`]],
  },
  {
    id: 'b11', kind: 'bug', category: 'error-format', testsCatch: true,
    rule: 'The 409 problem type is .../reviews-pending; the slug is changed.',
    edits: [[APPJS, `'reviews-pending', 'Reviews are pending'`, `'pending-reviews', 'Reviews are pending'`]],
  },

  // ── bugs the tests miss ──────────────────────────────────────────────────────────────
  {
    id: 'b02', kind: 'bug', category: 'validation', testsCatch: false,
    rule: 'The review endpoint accepts any truthy decision; the database CHECK then throws and the caller gets 500 instead of 400.',
    edits: [[APPJS, `if (!body || !['confirm', 'overturn'].includes(body.decision)) {`, `if (!body || !body.decision) {`]],
  },
  {
    id: 'b12', kind: 'bug', category: 'pending-409', testsCatch: false,
    rule: 'A submission with verdict unsure and no decision is pending; the count only looks at violation.',
    edits: [[APPJS, `.filter((s) => needsReview(s.verdict) && !s.decision).length;`, `.filter((s) => s.verdict === 'violation' && !s.decision).length;`]],
  },
  {
    id: 'b13', kind: 'bug', category: 'pending-409', testsCatch: false,
    rule: 'It refuses while reviews are pending, for every caller; admins skip the check.',
    edits: [[APPJS, `      if (!lab.published_at) {`, `      if (!lab.published_at && me.role !== 'admin') {`]],
  },
  {
    id: 'b14', kind: 'bug', category: 'authz', testsCatch: false,
    rule: 'The review queue is for staff of the class and admins; enrolled students can now read it.',
    edits: [[APPJS, `if (!lab || !isStaff(me, lab.class_id)) return problem(res, 404, 'not-found', 'No such lab');`, `if (!lab || !(isStaff(me, lab.class_id) || q.enrolled.get(lab.class_id, me.id))) {
        return problem(res, 404, 'not-found', 'No such lab');
      }`]],
  },
  {
    id: 'b15', kind: 'bug', category: 'authz', testsCatch: false,
    rule: 'Only staff of the class may review a submission; the staff check is removed, any signed-in user can decide.',
    edits: [[APPJS, `      if (!s || !isStaff(me, s.class_id)) {
        return problem(res, 404, 'not-found', 'No such submission');`, `      if (!s) {
        return problem(res, 404, 'not-found', 'No such submission');`]],
  },
  {
    id: 'b16', kind: 'bug', category: 'grading-logic', testsCatch: false,
    rule: 'Only a violation upheld by the TA takes marks off; unsure verdicts now deduct too.',
    edits: [[GRADES, `.filter((v) => v.verdict === 'violation' && v.decision !== 'overturn')`, `.filter((v) => v.verdict !== 'pass' && v.decision !== 'overturn')`]],
  },
  {
    id: 'b17', kind: 'bug', category: 'error-format', testsCatch: false,
    rule: 'Every error is problem details with type, title and status; title is dropped.',
    edits: [[HTTP, `JSON.stringify({ type: PROBLEM_BASE + slug, title, status, ...extra })`, `JSON.stringify({ type: PROBLEM_BASE + slug, status, ...extra })`]],
  },
  {
    id: 'b18', kind: 'bug', category: 'authz', testsCatch: false,
    rule: 'A student of another class must get 404 (same as a missing lab); every student now gets 403 and learns the lab exists.',
    edits: [[APPJS, `if (q.enrolled.get(lab.class_id, me.id)) {`, `if (me.role === 'student') {`]],
  },
  {
    id: 'b19', kind: 'bug', category: 'authz', testsCatch: false,
    rule: 'Staff are checked against the lab id instead of its class id; correct only while lab ids equal class ids, as in the seed.',
    edits: [[APPJS, `      if (!isStaff(me, lab.class_id)) {
        if (q.enrolled`, `      if (!isStaff(me, lab.id)) {
        if (q.enrolled`]],
  },
  {
    id: 'b20', kind: 'bug', category: 'security', testsCatch: false,
    rule: 'The bearer token is interpolated into SQL: a token like \'OR\'1\'=\'1 signs in as the first user (admin).',
    edits: [[APPJS, `return m ? q.userByToken.get(m[1]) : undefined;`, 'return m\n      ? db.prepare(`SELECT id, name, role FROM users WHERE token = \'${m[1]}\'`).get()\n      : undefined;']],
  },

  // ── clean changes: behaviour stays the same ──────────────────────────────────────────
  {
    id: 'c01', kind: 'clean', category: 'rename', testsCatch: false,
    rule: 'Renames the parameter of isStaff.',
    edits: [[APPJS, `const isStaff = (me, classId) => me.role === 'admin' || !!q.staff.get(classId, me.id);`, `const isStaff = (user, classId) => user.role === 'admin' || !!q.staff.get(classId, user.id);`]],
  },
  {
    id: 'c02', kind: 'clean', category: 'extract-function', testsCatch: false,
    rule: 'Moves the pending count into a helper.',
    edits: [
      [APPJS, `  const isStaff = (me, classId) =>`, `  const pendingReviews = (labId) =>
    q.byLab.all(labId).filter((s) => needsReview(s.verdict) && !s.decision).length;
  const isStaff = (me, classId) =>`],
      [APPJS, `        const pending = q.byLab
          .all(lab.id)
          .filter((s) => needsReview(s.verdict) && !s.decision).length;`, `        const pending = pendingReviews(lab.id);`],
    ],
  },
  {
    id: 'c03', kind: 'clean', category: 'comments', testsCatch: false,
    rule: 'Adds comments only.',
    edits: [
      [APPJS, `  const whoIs = (req) => {`, `  // The caller, from the Authorization header; undefined for no token or an unknown one.
  const whoIs = (req) => {`],
      [APPJS, `      if (!lab.published_at) {`, `      // A lab that is already published skips the check: repeating is safe (contract).
      if (!lab.published_at) {`],
    ],
  },
  {
    id: 'c04', kind: 'clean', category: 'rename', testsCatch: false,
    rule: 'Renames the path segments variable p to parts.',
    edits: [
      [APPJS, `const p = url.pathname.split('/').filter(Boolean);`, `const parts = url.pathname.split('/').filter(Boolean);`],
      [APPJS, /\bp\[/g, 'parts['],
      [APPJS, /\bp\.length/g, 'parts.length'],
    ],
  },
  {
    id: 'c05', kind: 'clean', category: 'refactor', testsCatch: false,
    rule: 'Rewrites markFor as a loop; same result.',
    edits: [[GRADES, `  const lost = verdicts
    .filter((v) => v.verdict === 'violation' && v.decision !== 'overturn')
    .reduce((sum, v) => sum + v.deduction, 0);`, `  let lost = 0;
  for (const v of verdicts) {
    if (v.verdict === 'violation' && v.decision !== 'overturn') lost += v.deduction;
  }`]],
  },
  {
    id: 'c06', kind: 'clean', category: 'refactor', testsCatch: false,
    rule: 'Writes needsReview with includes; same result.',
    edits: [[GRADES, `return verdict === 'violation' || verdict === 'unsure';`, `return ['violation', 'unsure'].includes(verdict);`]],
  },
  {
    id: 'c07', kind: 'clean', category: 'wording', testsCatch: false,
    rule: 'Changes the human-readable title of the 401; the contract fixes type and status, not the title text.',
    edits: [[APPJS, `'unauthenticated', 'Sign in first'`, `'unauthenticated', 'Sign in to continue'`]],
  },
  {
    id: 'c08', kind: 'clean', category: 'rename', testsCatch: false,
    rule: 'Renames a local variable in readJson.',
    edits: [
      [HTTP, `  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};`, `  let text = '';
  for await (const chunk of req) text += chunk;
  if (!text) return {};`],
      [HTTP, `return JSON.parse(raw);`, `return JSON.parse(text);`],
    ],
  },
  {
    id: 'c09', kind: 'clean', category: 'comments', testsCatch: false,
    rule: 'Adds JSDoc to grades.js.',
    edits: [
      [GRADES, `export function markFor(verdicts) {`, `/**
 * @param {{ verdict: string, decision?: string, deduction: number }[]} verdicts
 * @returns {number} the mark, 0 to 10
 */
export function markFor(verdicts) {`],
    ],
  },
  {
    id: 'c10', kind: 'clean', category: 'refactor', testsCatch: false,
    rule: 'Reads the lab id once into a const in the publish handler.',
    edits: [
      [APPJS, `    if (req.method === 'POST' && p[1] === 'labs' && p[3] === 'publish' && p.length === 4) {
      const lab = q.lab.get(Number(p[2]));`, `    if (req.method === 'POST' && p[1] === 'labs' && p[3] === 'publish' && p.length === 4) {
      const labId = Number(p[2]);
      const lab = q.lab.get(labId);`],
    ],
  },
];

function applyEdit(dir, [file, find, repl], id) {
  const path = join(dir, file);
  const s = readFileSync(path, 'utf8');
  let out;
  if (find instanceof RegExp) {
    if (!find.test(s)) throw new Error(`${id}: ${find} matches nothing in ${file}`);
    out = s.replace(find, repl);
  } else {
    const n = s.split(find).length - 1;
    if (n !== 1) throw new Error(`${id}: edit matches ${n} times in ${file}:\n${find}`);
    out = s.replace(find, () => repl);
  }
  writeFileSync(path, out);
}

function copyApp() {
  const d = mkdtempSync(join(tmpdir(), 'corpus-'));
  cpSync(APP, d, { recursive: true, filter: (p) => !p.includes('node_modules') });
  return d;
}

const manifest = { about: 'Built by corpus/build-corpus.mjs. Each patch is one fake pull request against the clean app in app/. kind: bug | clean. testsCatch: does `npm run check` go red on it (checked by `npm run verify-corpus`). rule: what the patch breaks, from app/docs/contract/publish.md or the behaviour of the clean code.', patches: [] };

for (const p of PATCHES) {
  const work = mkdtempSync(join(tmpdir(), `corpus-${p.id}-`));
  const a = join(work, 'a');
  const b = join(work, 'b');
  try {
    cpSync(copyApp(), a, { recursive: true });
    cpSync(a, b, { recursive: true });
    for (const e of p.edits) applyEdit(b, e, p.id);
    symlinkSync(join(APP, 'node_modules'), join(b, 'node_modules'), 'dir');
    const files = [...new Set(p.edits.map((e) => e[0]))];
    const pr = spawnSync(join(APP, 'node_modules/.bin/prettier'), ['--write', ...files], { cwd: b, encoding: 'utf8' });
    if (pr.status !== 0) throw new Error(`${p.id}: prettier failed: ${pr.stderr}`);
    rmSync(join(b, 'node_modules'));
    let diff = '';
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', 'a', 'b'], { cwd: work, encoding: 'utf8' });
    } catch (e) {
      diff = e.stdout; // git diff --no-index exits 1 when the trees differ
    }
    if (!diff.trim()) throw new Error(`${p.id}: produced no diff`);
    // paths relative to app/: a/a/src/x.js -> a/src/x.js
    diff = diff.replace(/(^|\s)a\/a\//gm, '$1a/').replace(/(^|\s)b\/b\//gm, '$1b/');
    writeFileSync(join(OUT, `${p.id}.patch`), diff);
    const { edits, ...meta } = p;
    manifest.patches.push({ ...meta, file: `${p.id}.patch`, files });
    console.log(`${p.id}  ${p.kind.padEnd(5)}  ${files.join(', ')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

manifest.patches.sort((x, y) => x.id.localeCompare(y.id));
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${manifest.patches.length} patches written.`);

#!/usr/bin/env node
// Evidence that every bug the tests miss is a real bug.
//   APP_DIR=<path to an app copy> node corpus/probes.mjs <patch id>
// Each probe checks the behaviour the contract (or the clean code) promises. It must pass on
// the clean app and fail on the app with that patch applied; `npm run verify-corpus` checks
// both. These are the tests the app is missing: the gap the reviewer is measured on.

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const APP_DIR = process.env.APP_DIR;
const id = process.argv[2];
const mod = (f) => import(pathToFileURL(join(APP_DIR, f)).href);
const { open } = await mod('src/db.js');
const { createApp } = await mod('src/app.js');
const { markFor } = await mod('src/grades.js');

async function start(seed = () => {}) {
  const db = open();
  seed(db);
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, token, body) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json };
  };
  return { db, call, close: () => new Promise((r) => server.close(r)) };
}

const PROBES = {
  // an invalid decision is a 400, not a crash
  b02: async ({ call }) => {
    const r = await call('POST', '/api/submissions/1/review', 'tok-ta-a', { decision: 'maybe' });
    assert.equal(r.status, 400);
  },
  // an unsure verdict with no decision is pending
  b12: {
    seed: (db) => db.exec("INSERT INTO submissions VALUES (4, 2, 6, 'unsure', NULL)"),
    run: async ({ call }) => {
      const r = await call('POST', '/api/labs/2/publish', 'tok-ta-b');
      assert.equal(r.status, 409);
      assert.equal(r.body.pending, 1);
    },
  },
  // an admin is refused too while reviews are pending
  b13: async ({ call, db }) => {
    const r = await call('POST', '/api/labs/1/publish', 'tok-admin');
    assert.equal(r.status, 409);
    assert.equal(db.prepare('SELECT published_at t FROM labs WHERE id = 1').get().t, null);
  },
  // a student cannot read the review queue
  b14: async ({ call }) => {
    const r = await call('GET', '/api/labs/1/queue', 'tok-stu1');
    assert.equal(r.status, 404);
  },
  // a student cannot decide a review
  b15: async ({ call, db }) => {
    const r = await call('POST', '/api/submissions/1/review', 'tok-stu1', { decision: 'overturn' });
    assert.equal(r.status, 404);
    assert.equal(db.prepare('SELECT decision d FROM submissions WHERE id = 1').get().d, null);
  },
  // an unsure verdict takes nothing off
  b16: async () => {
    assert.equal(markFor([{ verdict: 'unsure', deduction: 3 }]), 10);
  },
  // problem details carry a title
  b17: async ({ call }) => {
    const r = await call('POST', '/api/labs/2/publish', null);
    assert.equal(typeof r.body.title, 'string');
  },
  // a student of another class gets the same 404 as a missing lab
  b18: async ({ call }) => {
    const r = await call('POST', '/api/labs/2/publish', 'tok-stu1');
    assert.equal(r.status, 404);
  },
  // staff are checked against the lab's class, also when lab id != class id
  b19: {
    seed: (db) => db.exec("INSERT INTO labs (id, class_id, title) VALUES (3, 2, 'Quick sort')"),
    run: async ({ call }) => {
      const r = await call('POST', '/api/labs/3/publish', 'tok-ta-b');
      assert.equal(r.status, 200);
    },
  },
  // a crafted token does not sign in
  b20: async ({ call }) => {
    const r = await call('POST', '/api/labs/2/publish', "'OR'1'='1");
    assert.equal(r.status, 401);
  },
};

export const PROBE_IDS = Object.keys(PROBES);

if (id) {
  const p = PROBES[id];
  if (!p) {
    console.error(`no probe for ${id}`);
    process.exit(2);
  }
  const { seed, run } = typeof p === 'function' ? { run: p } : p;
  const app = await start(seed);
  try {
    await run(app);
    console.log(`probe ${id}: pass`);
  } catch (e) {
    console.log(`probe ${id}: FAIL ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

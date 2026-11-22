# agent-review-ci

SEMINAR F3 · CSC13114 Advanced Web Application Development · 23KTPM1 · HK1 2026–2027

**Question.** When an LLM reviewer is added to a CI gate that already runs lint, unit and
contract tests, how many seeded contract-breaking bugs that the tests miss does it block (%),
how many clean PRs does it wrongly block (%), and what does it add per PR in time (s) and
cost (USD)?

- **Baseline:** the gate is `npm run check` in `app/` (lint, format, unit, contract tests).
- **Change:** the same gate plus one LLM review step (`reviewer/`), with one fixed model and prompt.

The study itself is in [REPORT.md](REPORT.md).

## From a fresh clone to the numbers

You need Node 22.13+ and Git.

```bash
git clone https://github.com/DuyITLOR/agent-review-ci.git
cd agent-review-ci
npm run setup                 # npm ci inside app/
npm run verify-corpus         # clean app green; each patch applies; tests catch what the manifest says;
                              # every bug the tests miss is shown real by its probe
npm run measure -- --replay   # recompute every number from the recorded replies: no key, no cost
```

`--replay` re-runs the test gate on every patch and re-scores the model replies stored in
`results/raw/`. It writes to `results/replay/`; compare `results/replay/summary.md` with
`results/summary.md`.

### Live run (calls a model)

```bash
# Claude
export REVIEWER_PROVIDER=anthropic ANTHROPIC_API_KEY=... REVIEWER_MODEL=<model id from Anthropic docs>

# or any OpenAI-compatible server (GitHub Models, OpenRouter, OpenAI, local Ollama)
export REVIEWER_PROVIDER=openai-compatible REVIEWER_BASE_URL=<base url> REVIEWER_API_KEY=... REVIEWER_MODEL=<model id>

# prices per million tokens, from the provider's pricing page (0 for a free tier)
export REVIEWER_USD_PER_MTOK_IN=... REVIEWER_USD_PER_MTOK_OUT=...
export MAX_USD=2              # the run stops when it has spent more than this

npm run measure               # 5 runs; options: --runs N, --only b01,c01
```

## Layout

| Path | What it is |
|---|---|
| `app/` | The system under review: the clean version of the course starter (see *Source*) |
| `corpus/` | Fake pull requests (`build-corpus.mjs` → `*.patch`, `manifest.json`) and `probes.mjs` |
| `reviewer/` | The LLM reviewer: `prompt.md`, `index.js`, one file per provider |
| `scripts/measure.js` | The measurement: gate + reviewer on every patch, every run |
| `scripts/score.js` | How a reply is scored: *caught* = blocks and quotes a changed line |
| `scripts/summarize.js` | Median and spread across runs |
| `scripts/ci-review.js` | The reviewer as a CI step on a real PR (`.github/workflows/ci.yml`) |
| `results/` | Raw output of every reported run; `results/raw/` holds the model replies |

## The corpus

30 fake pull requests against `app/`: 20 seeded bugs (10 the tests catch, 10 they miss) and 10
clean changes. They are declared as small edits in `corpus/build-corpus.mjs`, which writes the
`.patch` files and `manifest.json`. For every bug the tests miss, `corpus/probes.mjs` holds a
check that passes on the clean app and fails on the patched one: the evidence that it is a real
bug.

To add or change one: edit `corpus/build-corpus.mjs` (and `corpus/probes.mjs` for a bug the
tests miss), then

```bash
node corpus/build-corpus.mjs && npm run verify-corpus   # every line must say ok / real bug
```

## The CI gate on real PRs

`.github/workflows/ci.yml` has two jobs: `gates` (the baseline, required on `main`) and
`agent-review` (the reviewer on the PR diff, posts its verdict as a comment). Configure the
reviewer in *Settings → Secrets and variables → Actions*:

| Name | Kind | Example |
|---|---|---|
| `REVIEWER_PROVIDER` | variable | `anthropic` or `openai-compatible` |
| `REVIEWER_MODEL` | variable | the model id, as the provider's docs spell it |
| `REVIEWER_BASE_URL` | variable | openai-compatible only |
| `REVIEWER_MODE` | variable | `warn` to comment without failing |
| `ANTHROPIC_API_KEY` / `REVIEWER_API_KEY` | secret | GitHub Models uses the built-in `GITHUB_TOKEN` |

With no reviewer configured, the job passes and says so (fail-open); so does an API error or a
reply that is not valid JSON. The test job stays the deterministic gate.

## Source

`app/` is built from [fithcmus/awad-quality-gate-starter](https://github.com/fithcmus/awad-quality-gate-starter)
(commit `fedc13d`, the CSC13114 session 7 starter). Its README is kept as
`app/STARTER_README.md`. We made it the clean baseline: fixed the lint error, made the
contract tests strict, and fixed the two places where `publish` broke its contract.

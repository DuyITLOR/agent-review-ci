https://github.com/DuyITLOR/agent-review-ci

# Does an LLM reviewer in CI catch the bugs our tests miss?

SEMINAR F3 · CSC13114 23KTPM1 · team: 23127178, 23127334, 23127344 · *(draft: fill every TODO; max three pages)*

## Question

When an LLM reviewer is added to a CI gate that already runs lint, unit and contract tests, how
many seeded contract-breaking bugs that the tests miss does it block (%), how many clean PRs does
it wrongly block (%), and what does it add per PR in time (s) and cost (USD)?

## Setup

- **System under review:** a slice of LeeTKOB (`app/`, from the course's session 7 starter, made
  clean: strict contract tests, code that meets `docs/contract/publish.md`).
- **Corpus:** 30 fake PRs (`corpus/`): 20 seeded bugs, 10 that the tests catch and 10 they
  miss, each of the 10 shown real by a probe (`corpus/probes.mjs`); 10 clean refactors.
- **Baseline:** `npm run check` (ESLint, Prettier, 5 unit tests, 9 contract tests).
- **Change:** the same gate plus one reviewer call (`reviewer/prompt.md`): diff + contract in,
  JSON verdict out. Block only on 7 listed classes; uncertain means pass; fail-open on errors.
- **Held fixed:** the clean app, the corpus, the prompt, the model *(TODO: id, as in the
  provider's docs, read on <date>)*, temperature 0, max tokens 1024, machine *(TODO: CPU, RAM,
  OS, Node version)*.
- **Scoring:** a bug is *caught* when the reviewer blocks and at least one finding quotes a line
  the patch adds or removes. A clean PR that is blocked is a *false alarm*. A finding that quotes
  no line of the diff is *invented*.
- **Runs:** 5 (`npm run measure`). The tests are deterministic; the runs measure the reviewer's
  spread. Every number below is in `results/summary.md` and the per-PR logs.

## Results

*(TODO: paste from `results/summary.md`: median and min–max over 5 runs.)*

| Metric | Median | Min–max |
|---|---|---|
| Baseline gate catches (of 20 bugs) | 50 % | – |
| Agent catches, of the 10 bugs the tests miss | TODO | TODO |
| Gate with agent catches (of 20) | TODO | TODO |
| False alarms (of 10 clean PRs) | TODO | TODO |
| Invented findings per run | TODO | TODO |
| Added time per PR | TODO s | TODO |
| Added cost per PR | TODO USD | TODO |

*(TODO: which bugs it never caught, by category; which clean PRs it blocked and why.)*

## Recommendation

*(TODO: when to add it; when not: e.g. contract already covered by tests, large diffs, no
budget. What it costs: time, money, triage of false alarms.)*

## Limits

- One small app and a corpus we wrote ourselves; real bugs are messier.
- The reviewer sees the diff and the contract only, not the rest of the code.
- The prompt lists the bug classes the corpus draws from; a generic prompt may do worse.
- One model, one prompt. *(TODO: appendix with a second reviewer, e.g. open-code-review, if done.)*

## Sources

*(TODO: every version, date, API fact with the official page and the date read.)*

- Model and API: TODO
- GitHub Actions workflow syntax, branch protection: TODO
- Course starter: https://github.com/fithcmus/awad-quality-gate-starter (commit `fedc13d`)

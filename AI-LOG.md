# AI-LOG

*(Draft. Rewrite in the format of the course's "AI-LOG.md — template and rules" on Classroom
before handing in.)*

| Tool | Used for | Changed / Rejected |
|---|---|---|
| Claude Code | Repository scaffold: reviewer interface, providers, `measure`, `score`, `summarize`, CI workflow | TODO: what we changed after reading it |
| Claude Code | Clean baseline from the starter: lint fix, the two contract fixes, stricter contract tests | Checked: the stricter tests fail on the original starter code (3 red) |
| Claude Code | First draft of the corpus (`corpus/build-corpus.mjs`) and the probes | TODO: which seeded bugs we rejected or rewrote, and why |

## Things the assistant got wrong, and how we caught them

- It first generated patches whose paths were `a/a/src/...`; `npm run verify-corpus` showed
  every patch failing to apply.
- A provider call returned HTTP 200 with the body `OK` (not JSON); the first version scored that
  as "did not block". Caught by reading `results/raw/`; providers now fail loudly on a
  non-JSON reply.
- TODO: add what you find while reviewing the corpus and the report.

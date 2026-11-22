// Turn per-patch records into per-run metrics, then median and spread across runs.

const pct = (a, b) => (b === 0 ? null : (100 * a) / b);

export function median(xs) {
  const v = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// One run: records = [{ patch, baseline, agent }]
export function runMetrics(records) {
  const bugs = records.filter((r) => r.patch.kind === 'bug');
  const clean = records.filter((r) => r.patch.kind === 'clean');
  const missed = bugs.filter((r) => !r.baseline.failed);
  const caughtByTests = bugs.filter((r) => r.baseline.failed);
  const gateWithAgent = bugs.filter((r) => r.baseline.failed || r.agent.caught);
  return {
    bugs: bugs.length,
    clean: clean.length,
    bugsMissedByTests: missed.length,
    testsCatchPct: pct(caughtByTests.length, bugs.length),
    agentCatchOnMissedPct: pct(missed.filter((r) => r.agent.caught).length, missed.length),
    agentCatchAllBugsPct: pct(bugs.filter((r) => r.agent.caught).length, bugs.length),
    gateWithAgentCatchPct: pct(gateWithAgent.length, bugs.length),
    falseAlarmPct: pct(clean.filter((r) => r.agent.falseAlarm).length, clean.length),
    blocksWithoutOnTargetFinding: bugs.filter((r) => r.agent.block && !r.agent.caught).length,
    inventedFindings: records.reduce((s, r) => s + r.agent.invented, 0),
    parseErrors: records.filter((r) => r.agent.parseError).length,
    baselineSecPerPr: median(records.map((r) => r.baseline.ms / 1000)),
    agentSecPerPr: median(records.map((r) => r.agent.ms / 1000)),
    agentUsdPerPr: records.reduce((s, r) => s + r.agent.usd, 0) / (records.length || 1),
    agentUsdTotal: records.reduce((s, r) => s + r.agent.usd, 0),
  };
}

export function acrossRuns(runs) {
  const keys = Object.keys(runs[0] ?? {});
  const out = {};
  for (const k of keys) {
    const xs = runs.map((r) => r[k]).filter((x) => x !== null);
    out[k] = {
      median: median(xs),
      min: xs.length ? Math.min(...xs) : null,
      max: xs.length ? Math.max(...xs) : null,
      runs: runs.map((r) => r[k]),
    };
  }
  return out;
}

const LABELS = {
  bugs: ['Bug patches', ''],
  clean: ['Clean patches', ''],
  bugsMissedByTests: ['Bugs the tests miss', ''],
  testsCatchPct: ['Baseline gate (tests) catches', '%'],
  agentCatchOnMissedPct: ['Agent catches, of bugs the tests miss', '%'],
  agentCatchAllBugsPct: ['Agent catches, of all bugs', '%'],
  gateWithAgentCatchPct: ['Gate with agent catches', '%'],
  falseAlarmPct: ['Agent blocks a clean PR (false alarm)', '%'],
  blocksWithoutOnTargetFinding: ['Agent blocks a bug PR for the wrong line', 'PRs'],
  inventedFindings: ['Findings quoting a line not in the diff', 'findings'],
  parseErrors: ['Replies that were not valid JSON', 'replies'],
  baselineSecPerPr: ['Baseline gate time per PR (median)', 's'],
  agentSecPerPr: ['Agent time per PR (median)', 's'],
  agentUsdPerPr: ['Agent cost per PR (mean)', 'USD'],
  agentUsdTotal: ['Agent cost per run (all PRs)', 'USD'],
};

const fmt = (x, unit) =>
  x === null || x === undefined
    ? '–'
    : unit === 'USD'
      ? x.toFixed(4)
      : Number.isInteger(x)
        ? String(x)
        : x.toFixed(1);

export function toMarkdown(summary, meta) {
  const lines = [
    `# Results`,
    '',
    `- reviewer: \`${meta.provider}\` · model: \`${meta.model}\` · temperature: ${meta.temperature}`,
    `- runs: ${meta.runs} · mode: ${meta.mode} · generated: ${meta.generatedAt}`,
    '',
    '| Metric | Unit | Median | Min | Max | Per run |',
    '|---|---|---|---|---|---|',
  ];
  for (const [k, [label, unit]] of Object.entries(LABELS)) {
    const s = summary[k];
    if (!s) continue;
    lines.push(
      `| ${label} | ${unit} | ${fmt(s.median, unit)} | ${fmt(s.min, unit)} | ${fmt(s.max, unit)} | ${s.runs.map((x) => fmt(x, unit)).join(', ')} |`,
    );
  }
  return lines.join('\n') + '\n';
}

// How one reviewer verdict is scored against one patch. Pure functions, no I/O.

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// The lines of a unified diff, split into changed (+/-) and context lines, without the marker.
export function diffLines(diff) {
  const changed = [];
  const context = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+') || line.startsWith('-')) changed.push(norm(line.slice(1)));
    else if (line.startsWith(' ')) context.push(norm(line.slice(1)));
  }
  return { changed: changed.filter(Boolean), context: context.filter(Boolean) };
}

// A finding's quote matches a line if one contains the other (models trim or shorten lines).
const matches = (quote, line) => quote.length >= 6 && (line.includes(quote) || quote.includes(line));

// on target: quotes a line the patch adds or removes.
// invented:  quotes nothing that is in the diff at all.
export function classifyFinding(finding, lines) {
  const q = norm(finding.quote);
  if (lines.changed.some((l) => matches(q, l))) return 'on-target';
  if (lines.context.some((l) => matches(q, l))) return 'context';
  return 'invented';
}

// The verdict of one reviewer reply on one patch.
//   bug patch:   caught = block and at least one on-target finding
//   clean patch: falseAlarm = block
export function scoreAgent(patch, diff, verdict) {
  const lines = diffLines(diff);
  const kinds = verdict.findings.map((f) => classifyFinding(f, lines));
  const onTarget = kinds.filter((k) => k === 'on-target').length;
  const invented = kinds.filter((k) => k === 'invented').length;
  return {
    block: verdict.block,
    parseError: verdict.parseError,
    findings: verdict.findings.length,
    onTarget,
    invented,
    caught: patch.kind === 'bug' ? verdict.block && onTarget > 0 : null,
    falseAlarm: patch.kind === 'clean' ? verdict.block : null,
  };
}

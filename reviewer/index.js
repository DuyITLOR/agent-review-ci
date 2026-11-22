// The reviewer: one interface, the provider chosen by environment.
//
//   review({ diff, contract }) -> { block, findings, parseError, text, usage }
//
// Env:
//   REVIEWER_PROVIDER   anthropic | openai-compatible
//   REVIEWER_MODEL      model id, exactly as the provider's docs spell it
//   REVIEWER_USD_PER_MTOK_IN / REVIEWER_USD_PER_MTOK_OUT
//                       prices per million tokens, copied from the provider's pricing page
//                       (0 for a free tier). Never guessed in code.
//   REVIEWER_TEMPERATURE (default 0), REVIEWER_MAX_TOKENS (default 1024)

import { readFileSync } from 'node:fs';
import * as anthropic from './providers/anthropic.js';
import * as openaiCompatible from './providers/openai-compatible.js';

const PROVIDERS = { anthropic, 'openai-compatible': openaiCompatible };
export const SYSTEM_PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');

export function config(env = process.env) {
  return {
    provider: env.REVIEWER_PROVIDER ?? '',
    model: env.REVIEWER_MODEL ?? '',
    temperature: Number(env.REVIEWER_TEMPERATURE ?? 0),
    maxTokens: Number(env.REVIEWER_MAX_TOKENS ?? 1024),
    usdPerMTokIn: Number(env.REVIEWER_USD_PER_MTOK_IN ?? 0),
    usdPerMTokOut: Number(env.REVIEWER_USD_PER_MTOK_OUT ?? 0),
  };
}

export function userMessage({ diff, contract }) {
  return `CONTRACT:\n\n${contract}\n\nDIFF:\n\n${diff}`;
}

// Call the model once. Returns the raw text and usage; parsing is separate so replay can
// re-parse recorded text without a key.
export async function call({ diff, contract }, cfg = config()) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new Error(`REVIEWER_PROVIDER must be one of: ${Object.keys(PROVIDERS).join(', ')}`);
  if (!cfg.model) throw new Error('REVIEWER_MODEL is not set');
  const t0 = performance.now();
  const out = await p.complete({
    system: SYSTEM_PROMPT,
    user: userMessage({ diff, contract }),
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    temperature: cfg.temperature,
  });
  const ms = Math.round(performance.now() - t0);
  const usd = (out.inTok * cfg.usdPerMTokIn + out.outTok * cfg.usdPerMTokOut) / 1e6;
  return {
    provider: cfg.provider,
    model: cfg.model,
    temperature: cfg.temperature,
    text: out.text,
    usage: { inTok: out.inTok, outTok: out.outTok, usd, ms },
  };
}

// Turn the model's text into a verdict. A reply we cannot parse does not block, and is counted.
export function parse(text) {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  try {
    const j = JSON.parse(m ? m[0] : '');
    return {
      block: j.block === true,
      findings: Array.isArray(j.findings) ? j.findings : [],
      parseError: false,
    };
  } catch {
    return { block: false, findings: [], parseError: true };
  }
}

export async function review(input, cfg = config()) {
  const rec = await call(input, cfg);
  return { ...rec, ...parse(rec.text) };
}

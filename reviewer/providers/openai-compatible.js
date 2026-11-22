// Any server that speaks the OpenAI chat-completions shape: GitHub Models, OpenRouter,
// OpenAI, or a local Ollama. Only the base URL and the key change.
// Env: REVIEWER_BASE_URL, REVIEWER_API_KEY (falls back to GITHUB_TOKEN), REVIEWER_MODEL.
//
//   GitHub Models  REVIEWER_BASE_URL=https://models.github.ai/inference   key: GITHUB_TOKEN
//   Ollama         REVIEWER_BASE_URL=http://localhost:11434/v1            key: any string
//
// Check the base URL and model id in the provider's own documentation before a run.

export async function complete({ system, user, model, maxTokens, temperature }) {
  const base = process.env.REVIEWER_BASE_URL;
  if (!base) throw new Error('REVIEWER_BASE_URL is not set');
  const key = process.env.REVIEWER_API_KEY ?? process.env.GITHUB_TOKEN ?? '';
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`openai-compatible ${res.status}: not JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok || !Array.isArray(body.choices)) {
    throw new Error(`openai-compatible ${res.status}: ${text.slice(0, 500)}`);
  }
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    inTok: body.usage?.prompt_tokens ?? 0,
    outTok: body.usage?.completion_tokens ?? 0,
    raw: body,
  };
}

// Claude through the Anthropic Messages API. No SDK: one fetch, so the request is visible.
// Env: ANTHROPIC_API_KEY, REVIEWER_MODEL.

export async function complete({ system, user, model, maxTokens, temperature }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`anthropic ${res.status}: not JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok || !Array.isArray(body.content)) {
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 500)}`);
  }
  return {
    text: body.content.map((c) => c.text ?? '').join(''),
    inTok: body.usage?.input_tokens ?? 0,
    outTok: body.usage?.output_tokens ?? 0,
    raw: body,
  };
}

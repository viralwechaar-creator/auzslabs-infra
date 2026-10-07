// The only outbound call this app ever makes: Anthropic's Messages API, from the server, with the key from the environment.
const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';

export class LlmError extends Error {}

export function createLlm({ env = process.env, fetchImpl = fetch } = {}) {
  const url = env.ANTHROPIC_API_URL || DEFAULT_URL; // override exists for tests / a proxy only
  const hasKey = () => Boolean(env.ANTHROPIC_API_KEY);

  async function complete({ system, user, model, maxTokens = 2000 }) {
    if (!hasKey()) throw new LlmError('ANTHROPIC_API_KEY is not set on the server.');
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 429 || res.status >= 500) { lastErr = new LlmError(`The AI service is busy (${res.status}). Try again.`); await new Promise((r) => setTimeout(r, 1500)); continue; }
        if (!res.ok) {
          let detail = '';
          try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
          throw new LlmError(`The AI service refused the request (${res.status}). ${detail}`.trim().slice(0, 300));
        }
        const data = await res.json();
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (!text) throw new LlmError('The AI returned an empty answer.');
        return text;
      } catch (e) {
        if (e instanceof LlmError) { lastErr = e; if (!/busy/.test(e.message)) throw e; } else { lastErr = new LlmError('Could not reach the AI service.'); }
      }
    }
    throw lastErr;
  }
  return { complete, hasKey };
}

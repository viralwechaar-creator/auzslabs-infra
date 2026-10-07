import { tokens } from './util.js';
import { routerSystem } from './prompts.js';

export function createRouter({ roster, llm, config }) {
  function byKeywords(deptId, text) {
    const agents = roster.inDepartment(deptId);
    const tt = new Set(tokens(text));
    let best = agents[0], bestScore = -1;
    for (const a of agents) {
      let s = 0;
      for (const w of tokens(`${a.name} ${a.name} ${a.role} ${a.job}`)) if (tt.has(w)) s++;
      if (s > bestScore) { best = a; bestScore = s; }
    }
    return { agentId: best.id, by: 'keywords', reason: bestScore > 0 ? 'Matched words in the task.' : 'No clear match; first agent in the department.' };
  }

  async function route(deptId, text) {
    const agents = roster.inDepartment(deptId);
    if (!agents.length) throw new Error('Unknown department.');
    if (agents.length === 1) return { agentId: agents[0].id, by: 'only-agent', reason: 'Only agent in the department.' };
    if (llm.hasKey()) {
      try {
        const out = await llm.complete({ system: routerSystem(agents), user: `<task>\n${text}\n</task>`, model: config.routerModel, maxTokens: 120 });
        const m = out.match(/\{[\s\S]*?\}/);
        const j = m ? JSON.parse(m[0]) : null;
        if (j && agents.some((a) => a.id === j.agent)) return { agentId: j.agent, by: 'ai', reason: String(j.reason || '').slice(0, 120) };
      } catch { /* fall back to keywords */ }
    }
    return byKeywords(deptId, text);
  }
  return { route };
}
